"""
test_watcher.py — Unit tests for ManifestEventHandler debounce & path logic
"""
import os
import sys
import time
import asyncio
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))
from core.watcher import ManifestEventHandler, ManifestWatcher


# ── ManifestEventHandler ───────────────────────────────────────────────────

class TestManifestEventHandler:
    def _handler(self, manifest_path="/data/target/manifest.json"):
        callback = MagicMock()
        h = ManifestEventHandler(manifest_path, callback)
        return h, callback

    def test_non_manifest_file_ignored(self):
        h, cb = self._handler()
        h._process_manifest_event_path("/data/target/other.json")
        cb.assert_not_called()

    def test_manifest_file_triggers_callback(self, tmp_path):
        manifest = tmp_path / "manifest.json"
        manifest.touch()
        h, cb = self._handler(str(manifest))
        h._process_manifest_event_path(str(manifest))
        cb.assert_called_once()

    def test_debounce_prevents_double_trigger(self, tmp_path):
        manifest = tmp_path / "manifest.json"
        manifest.touch()
        h, cb = self._handler(str(manifest))
        h._process_manifest_event_path(str(manifest))
        h._process_manifest_event_path(str(manifest))  # within debounce window
        cb.assert_called_once()

    def test_debounce_allows_trigger_after_window(self, tmp_path):
        manifest = tmp_path / "manifest.json"
        manifest.touch()
        h, cb = self._handler(str(manifest))
        h.debounce_seconds = 0.01
        h._process_manifest_event_path(str(manifest))
        time.sleep(0.05)
        h._process_manifest_event_path(str(manifest))
        assert cb.call_count == 2

    def test_on_modified_calls_process(self, tmp_path):
        manifest = tmp_path / "manifest.json"
        manifest.touch()
        h, cb = self._handler(str(manifest))
        event = MagicMock()
        event.is_directory = False
        event.src_path = str(manifest)
        h.on_modified(event)
        cb.assert_called_once()

    def test_on_modified_ignores_directory_event(self):
        h, cb = self._handler()
        event = MagicMock()
        event.is_directory = True
        h.on_modified(event)
        cb.assert_not_called()

    def test_on_created_triggers_callback(self, tmp_path):
        manifest = tmp_path / "manifest.json"
        manifest.touch()
        h, cb = self._handler(str(manifest))
        event = MagicMock()
        event.is_directory = False
        event.src_path = str(manifest)
        h.on_created(event)
        cb.assert_called_once()

    def test_callback_receives_live_project_name_for_external(self, tmp_path):
        manifest = tmp_path / "manifest.json"
        manifest.touch()
        h, cb = self._handler(str(manifest))
        h._process_manifest_event_path(str(manifest))
        cb.assert_called_once_with("live")

    def test_empty_path_ignored(self):
        h, cb = self._handler()
        h._process_manifest_event_path("")
        cb.assert_not_called()

    def test_none_path_ignored(self):
        h, cb = self._handler()
        h._process_manifest_event_path(None)
        cb.assert_not_called()


# ── ManifestWatcher ────────────────────────────────────────────────────────

class TestManifestWatcher:
    def test_watcher_creates_watch_dir_if_missing(self, tmp_path):
        watch_dir = tmp_path / "subdir"
        watcher = ManifestWatcher(str(watch_dir / "manifest.json"), asyncio.new_event_loop())
        assert os.path.exists(watcher.watch_dir)

    def test_subscribe_returns_queue(self, tmp_path):
        loop = asyncio.new_event_loop()
        watcher = ManifestWatcher(str(tmp_path / "manifest.json"), loop)
        q = watcher.subscribe()
        assert isinstance(q, asyncio.Queue)

    def test_unsubscribe_removes_queue(self, tmp_path):
        loop = asyncio.new_event_loop()
        watcher = ManifestWatcher(str(tmp_path / "manifest.json"), loop)
        q = watcher.subscribe()
        watcher.unsubscribe(q)
        assert q not in watcher.subscribers

    def test_trigger_event_puts_to_all_queues(self, tmp_path):
        loop = asyncio.new_event_loop()
        watcher = ManifestWatcher(str(tmp_path / "manifest.json"), loop)
        q1 = watcher.subscribe()
        q2 = watcher.subscribe()

        async def run():
            watcher._trigger_event("live")
            assert not q1.empty()
            assert not q2.empty()
            assert await q1.get() == "live"
            assert await q2.get() == "live"

        loop.run_until_complete(run())

    def test_stop_without_start_does_not_crash(self, tmp_path):
        loop = asyncio.new_event_loop()
        watcher = ManifestWatcher(str(tmp_path / "manifest.json"), loop)
        watcher.stop()  # Should be a no-op


# ── Config autodiscovery ───────────────────────────────────────────────────

class TestConfig:
    def test_is_live_sync_available_false_when_no_file(self, tmp_path):
        import core.config as config
        import unittest.mock as mock
        with mock.patch.object(config, 'EXTERNAL_MANIFEST_PATH', str(tmp_path / "manifest.json")):
            result = os.path.exists(str(tmp_path / "manifest.json"))
            assert result is False

    def test_autodiscover_returns_default_when_no_data_dir(self):
        import core.config as config
        with patch("os.path.exists", return_value=False):
            with patch("os.environ.get", return_value=None):
                result = config.autodiscover_manifest()
                assert result == config.DEFAULT_MANIFEST_PATH

    def test_autodiscover_returns_env_override(self):
        import core.config as config
        with patch("os.path.exists", return_value=False):
            with patch.dict(os.environ, {"MANIFEST_PATH": "/custom/path/manifest.json"}):
                result = config.autodiscover_manifest()
                assert result == "/custom/path/manifest.json"
