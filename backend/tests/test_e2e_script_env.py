import importlib.util
import sys
from pathlib import Path

import pytest


SCRIPT_PATH = (
    Path(__file__).resolve().parents[2] / "scripts" / "test_flow_bisnis.py"
)


def load_test_flow_bisnis_module():
    module_name = "test_flow_bisnis_env_regression"
    sys.modules.pop(module_name, None)
    spec = importlib.util.spec_from_file_location(module_name, SCRIPT_PATH)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_e2e_dummy_password_wajib_dari_environment(monkeypatch):
    module = load_test_flow_bisnis_module()
    monkeypatch.delenv("DUMMY_KEPALA_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="DUMMY_KEPALA_PASSWORD"):
        module.get_user_config("kepala")


def test_e2e_dummy_user_config_membaca_password_dari_environment(monkeypatch):
    module = load_test_flow_bisnis_module()
    monkeypatch.setenv("DUMMY_KEPALA_USERNAME", "kepala-env")
    monkeypatch.setenv("DUMMY_KEPALA_PASSWORD", "password-dari-env")

    assert module.get_user_config("kepala") == {
        "username": "kepala-env",
        "password": "password-dari-env",
    }
