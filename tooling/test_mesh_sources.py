"""Reject corrupted cached inputs before generating a substitute anatomy."""
import subprocess
import tempfile
import unittest
from pathlib import Path
import prep_meshes

class SourceIntegrityTests(unittest.TestCase):
    def test_python_rejects_corrupt_cache(self):
        previous = prep_meshes.CACHE
        try:
            with tempfile.TemporaryDirectory() as directory:
                prep_meshes.CACHE = Path(directory)
                source = prep_meshes.SOURCES["cortex"]
                (prep_meshes.CACHE / source["filename"]).write_bytes(b"not a surface")
                with self.assertRaisesRegex(ValueError, "checksum mismatch"):
                    prep_meshes.cached(source)
        finally:
            prep_meshes.CACHE = previous

    def test_node_rejects_corrupt_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / prep_meshes.SOURCES["cortex"]["filename"]).write_bytes(b"not a surface")
            result = subprocess.run(["node", str(prep_meshes.HERE / "prep_meshes.mjs"),
                                     "--cache-dir", directory, "--out-dir", str(root / "out")],
                                    capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("checksum mismatch", result.stderr)
            self.assertFalse((root / "out" / "brain.glb").exists())

if __name__ == "__main__":
    unittest.main()
