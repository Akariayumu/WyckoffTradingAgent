"""打印自部署用的完整 Supabase schema（全部表、唯一约束与 RLS），供新项目一次性建库。

本项目不保留 .sql 文件，且 Supabase Python SDK 走 REST 不支持 DDL，
故 schema 以 core/self_host_schema.py 的常量形式版本化并由此脚本输出。
脚本幂等，可在 Supabase SQL Editor 中整段重复执行。

用法::

    python scripts/print_self_host_ddl.py > /tmp/wyckoff_schema.sql
"""

from __future__ import annotations

import _bootstrap  # noqa: F401

from core.self_host_schema import build_ddl


def main() -> int:
    print(build_ddl())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
