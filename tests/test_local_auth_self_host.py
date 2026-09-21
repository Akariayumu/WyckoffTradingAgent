import sys
import types

from integrations import local_auth
from integrations.supabase_public_config import SUPABASE_ANON_KEY, SUPABASE_ANON_URL


def _capture_create_client(monkeypatch):
    calls = []
    fake = types.ModuleType("supabase")
    fake.create_client = lambda url, key: calls.append((url, key)) or object()
    monkeypatch.setitem(sys.modules, "supabase", fake)
    return calls


def test_create_client_prefers_self_hosted_env(monkeypatch):
    calls = _capture_create_client(monkeypatch)
    monkeypatch.setenv("SUPABASE_URL", "https://self.supabase.co")
    monkeypatch.setenv("SUPABASE_KEY", "self-anon")

    local_auth._create_client()

    assert calls == [("https://self.supabase.co", "self-anon")]


def test_create_client_falls_back_to_builtin_config(monkeypatch):
    calls = _capture_create_client(monkeypatch)
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)

    local_auth._create_client()

    assert calls == [(SUPABASE_ANON_URL, SUPABASE_ANON_KEY)]
