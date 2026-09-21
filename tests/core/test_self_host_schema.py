"""自部署 schema 必须覆盖全部云端表，并与写入代码的字段、on_conflict 键保持一致。

这些断言是 schema 漂移的护栏：上游给某张表的写入行新增键、或新增 upsert 冲突键时，
这里会失败，提示同步 core/self_host_schema.py。
"""

from __future__ import annotations

import re
from datetime import date

import pandas as pd

import core.constants as constants
from core import factor_ic_schema, review_capture_schema, review_shadow_lane_schema, self_host_schema
from core.recommendation_payload import build_recommendation_payload
from core.signal_feedback import build_signal_observations, build_signal_registry_updates, summarize_signal_health
from core.strategy_reflection import build_policy_candidate, build_strategy_reflection
from integrations.supabase_theme_radar import build_theme_radar_snapshot_row
from tools.external_seeds import ExternalSeedConfig, build_external_seed_rows
from workflows.daily_job_persistence import benchmark_context_payload
from workflows.funnel_ai_selection import _policy_shadow_row
from workflows.signal_feedback_job import _outcome_row
from workflows.step2_signal_confirmation import build_pending_signal_rows
from workflows.strategy_attribution_report import slim_report_for_storage
from workflows.strategy_attribution_stats import build_strategy_attribution_payload

TODAY = "2026-09-21"
SPECS = {spec.name: spec for spec in self_host_schema.TABLES}

# 写入代码里的 on_conflict 键（integrations/*、workflows/*、web activity.ts）。
CONFLICT_KEYS = {
    constants.TABLE_THEME_RADAR_SNAPSHOT: [("trade_date",)],
    constants.TABLE_RECOMMENDATION_TRACKING: [("code", "recommend_date"), ("id",)],
    constants.TABLE_RECOMMENDATION_TRACKING_HK: [("code", "recommend_date")],
    constants.TABLE_RECOMMENDATION_TRACKING_US: [("code", "recommend_date")],
    constants.TABLE_SIGNAL_OBSERVATIONS: [("market", "trade_date", "code", "signal_type")],
    constants.TABLE_SIGNAL_OUTCOMES: [("observation_id", "horizon_days")],
    constants.TABLE_SIGNAL_REGISTRY: [("market", "signal_type", "regime")],
    constants.TABLE_SIGNAL_HEALTH_DAILY: [("market", "as_of_date", "signal_type", "regime", "horizon_days")],
    constants.TABLE_SIGNAL_POLICY_SHADOW_RUNS: [("market", "trade_date")],
    constants.TABLE_STRATEGY_REFLECTIONS: [("market", "as_of_date", "horizon_days")],
    constants.TABLE_STRATEGY_POLICY_CANDIDATES: [("market", "as_of_date")],
    constants.TABLE_CONCEPT_HEAT_HISTORY: [("trade_date", "concept_name")],
    constants.TABLE_EXTERNAL_SEED_OBSERVATIONS: [("market", "trade_date", "source", "code")],
    constants.TABLE_MARKET_SIGNAL_DAILY: [("trade_date",)],
    constants.TABLE_PORTFOLIOS: [("portfolio_id",)],
    constants.TABLE_DAILY_NAV: [("portfolio_id", "trade_date")],
    constants.TABLE_STRATEGY_ATTRIBUTION_REPORTS: [("report_date", "market", "window_start", "window_end")],
    self_host_schema.TABLE_USER_DAILY_ACTIVITY: [("activity_date", "user_id")],
}


def _columns(table: str) -> set[str]:
    return {name for name, _spec in SPECS[table].columns}


def _unique_keys(spec: self_host_schema.TableSpec) -> set[tuple[str, ...]]:
    keys = {(name,) for name, ddl in spec.columns if "primary key" in ddl}
    for text in (*spec.constraints, *(index for index in spec.indexes if "unique index" in index)):
        match = re.search(r"(?:unique|primary key)[^(]*\(([^)]+)\)", text)
        if match:
            keys.add(tuple(part.strip() for part in match.group(1).split(",")))
    return keys


def _assert_fits(table: str, rows: list[dict]) -> None:
    assert rows, f"{table}: builder produced no rows"
    unknown = set().union(*rows) - _columns(table)
    assert not unknown, f"{table} 写入了 schema 没有的列 {sorted(unknown)}，请同步 core/self_host_schema.py"


def test_every_cloud_table_is_covered_once() -> None:
    expected = {value for key, value in vars(constants).items() if key.startswith("TABLE_")}
    expected |= {
        self_host_schema.TABLE_PLANET_MEMBERS,
        self_host_schema.TABLE_USER_ACTIVITY_EVENTS,
        self_host_schema.TABLE_USER_DAILY_ACTIVITY,
        self_host_schema.TABLE_ANALYTICS_EXCLUDED_USERS,
    }
    names = [spec.name for spec in self_host_schema.TABLES] + [name for name, _ in self_host_schema.VERSIONED_TABLES]

    assert len(names) == len(set(names))
    assert set(names) == expected


def test_every_upsert_conflict_key_has_a_unique_constraint() -> None:
    for table, keys in CONFLICT_KEYS.items():
        available = _unique_keys(SPECS[table])
        for key in keys:
            assert key in available, f"{table} 缺少 on_conflict({','.join(key)}) 对应的唯一约束"


def test_versioned_tables_keep_their_conflict_keys() -> None:
    assert factor_ic_schema.UNIQUE_KEY == ("eval_date", "factor_name", "horizon", "segment")
    assert review_capture_schema.UNIQUE_KEY == ("trade_date", "ts_code")
    assert review_shadow_lane_schema.UNIQUE_KEY == ("trade_date", "ts_code", "lane")


def test_signal_pending_uniqueness_only_covers_active_rows() -> None:
    index = next(i for i in SPECS[constants.TABLE_SIGNAL_PENDING].indexes if "uq_signal_pending_active" in i)

    assert "(code, signal_type)" in index
    assert "where status in ('pending', 'survived')" in index


def test_ddl_enables_rls_everywhere_and_is_transactional() -> None:
    ddl = self_host_schema.build_ddl()

    for table, access in self_host_schema.table_access().items():
        assert f"alter table public.{table} enable row level security;" in ddl
        assert f"revoke all on table public.{table} from anon;" in ddl
        if access == self_host_schema.SERVICE_ONLY:
            assert f"on public.{table} for" not in ddl
    assert ddl.startswith("-- ") and "\nbegin;\n" in ddl
    assert ddl.rstrip().endswith("commit;")
    assert "drop table" not in ddl.lower()


def test_portfolio_policies_isolate_by_user_live_suffix() -> None:
    ddl = self_host_schema.build_ddl()
    owner = "split_part(portfolio_id, ':', 2) = (select auth.uid())::text"

    for table in (constants.TABLE_PORTFOLIOS, constants.TABLE_PORTFOLIO_POSITIONS):
        assert f"create policy {table}_all_own on public.{table} for all to authenticated" in ddl
    assert ddl.count(f"using ({owner})") == 4
    assert ddl.count(f"with check ({owner})") == 2


def test_membership_and_settings_rows_are_private() -> None:
    access = self_host_schema.table_access()

    assert access[self_host_schema.TABLE_PLANET_MEMBERS] == self_host_schema.OWN_USER_READ
    assert access[constants.TABLE_USER_SETTINGS] == self_host_schema.OWN_USER_ALL
    assert access[constants.TABLE_SIGNAL_OBSERVATIONS] == self_host_schema.SHARED_READ


def test_recommendation_rows_fit_schema() -> None:
    item = {
        "code": "000001",
        "name": "平安银行",
        "tag": "spring",
        "close": 11.2,
        "score": 3.5,
        "signal_types": ["spring"],
        "springboard_a": True,
        "springboard_evidence": {"a": 1},
        "candidate_reasons": ["x"],
        "candidate_metrics": {"m": 1},
        "dynamic_shadow_promotion": {"status": "ok"},
    }

    _assert_fits(constants.TABLE_RECOMMENDATION_TRACKING, build_recommendation_payload(20260921, [item], {}, {}))


def test_signal_feedback_rows_fit_schema() -> None:
    observations = build_signal_observations(
        TODAY,
        {"spring": [("000001", 2.5)]},
        selected_for_ai=["000001"],
        springboard_map={"000001": {"springboard_grade": "A", "springboard_evidence": {"k": 1}}},
        candidate_metadata_map={"000001": {"strategy_version": "v1"}},
        entry_quality_map={"000001": {"score": 80, "grade": "A"}},
    )
    _assert_fits(constants.TABLE_SIGNAL_OBSERVATIONS, observations)

    class Outcome:
        horizon = 5
        status = "done"
        return_pct = 3.2
        max_drawdown_pct = -1.1

    outcome = _outcome_row({**observations[0], "id": 1}, Outcome())
    _assert_fits(constants.TABLE_SIGNAL_OUTCOMES, [outcome])
    health = summarize_signal_health([outcome] * 40, as_of_date=TODAY)
    _assert_fits(constants.TABLE_SIGNAL_HEALTH_DAILY, health)
    _assert_fits(constants.TABLE_SIGNAL_REGISTRY, build_signal_registry_updates(health, horizon_days=5))

    report = build_strategy_attribution_payload(
        report_date=date(2026, 9, 21),
        market="cn",
        window_start=date(2026, 8, 21),
        window_end=date(2026, 9, 21),
        horizons=[1, 3, 5],
        observations=[{**observations[0], "id": 1}],
        outcomes=[outcome],
        shadow_runs=[],
    )
    _assert_fits(constants.TABLE_STRATEGY_ATTRIBUTION_REPORTS, [slim_report_for_storage(report)])

    reflection = build_strategy_reflection([outcome], [], as_of_date=TODAY)
    _assert_fits(constants.TABLE_STRATEGY_REFLECTIONS, [reflection])
    summary = {**reflection["summary"], "preferred_track": "Trend"}
    _assert_fits(
        constants.TABLE_STRATEGY_POLICY_CANDIDATES, [build_policy_candidate({**reflection, "summary": summary})]
    )


def test_funnel_side_rows_fit_schema() -> None:
    df = pd.DataFrame(
        {
            "date": pd.date_range("2026-08-01", periods=40),
            "open": 10.0,
            "high": 11.0,
            "low": 9.5,
            "close": 10.5,
            "volume": 1e6,
        }
    )
    pending = build_pending_signal_rows(
        signal_date=TODAY,
        triggers={"spring": [("000001", 2.0)], "sos": [("600000", 1.5)]},
        df_map={"000001": df, "600000": df},
        candidate_metadata_map={"000001": {"candidate_lane": "trend"}},
    )
    _assert_fits(constants.TABLE_SIGNAL_PENDING, pending)

    seeds = build_external_seed_rows(
        ExternalSeedConfig(enabled=True, symbols=("000001",)),
        TODAY,
        l1_codes=["000001"],
        l2_codes=[],
        l4_triggers={"spring": [("000001", 1.0)]},
        name_map={},
        sector_map={},
    )
    _assert_fits(constants.TABLE_EXTERNAL_SEED_OBSERVATIONS, seeds)

    radar = build_theme_radar_snapshot_row({"trade_date": TODAY, "themes": [{"theme": "AI"}]})
    _assert_fits(constants.TABLE_THEME_RADAR_SNAPSHOT, [radar])

    benchmark = {"trade_date": TODAY, **benchmark_context_payload({"regime": "risk_on", "close": 3000})}
    _assert_fits(constants.TABLE_MARKET_SIGNAL_DAILY, [benchmark])

    shadow = _policy_shadow_row({}, {"end_trade_date": TODAY}, ["000001"], ["000001"], [], [], "NEUTRAL")
    _assert_fits(constants.TABLE_SIGNAL_POLICY_SHADOW_RUNS, [shadow])
