from __future__ import annotations

import sys
from types import ModuleType

import pytest

from integrations import tushare_client


class _FakeDataApi:
    _DataApi__http_url = "http://api.waditu.com/dataapi"

    def __init__(self, token: str) -> None:
        self.token = token


def _install_fake_tushare(monkeypatch) -> None:
    fake_ts = ModuleType("tushare")
    fake_ts.pro_api = _FakeDataApi
    monkeypatch.setitem(sys.modules, "tushare", fake_ts)
    monkeypatch.setenv("TUSHARE_TOKEN", "token")


def _underlying(pro) -> _FakeDataApi:
    return object.__getattribute__(pro, "_pro")


def test_default_keeps_sdk_endpoint(monkeypatch) -> None:
    _install_fake_tushare(monkeypatch)
    monkeypatch.delenv("TUSHARE_API_URL", raising=False)

    assert _underlying(tushare_client.get_pro())._DataApi__http_url == "http://api.waditu.com/dataapi"


def test_api_url_redirects_requests_to_compatible_endpoint(monkeypatch) -> None:
    _install_fake_tushare(monkeypatch)
    monkeypatch.setenv("TUSHARE_API_URL", " https://relay.example/ ")

    assert _underlying(tushare_client.get_pro())._DataApi__http_url == "https://relay.example/"


def test_api_url_must_be_https(monkeypatch) -> None:
    _install_fake_tushare(monkeypatch)
    monkeypatch.setenv("TUSHARE_API_URL", "http://relay.example/")

    with pytest.raises(ValueError, match="https"):
        tushare_client.get_pro()
