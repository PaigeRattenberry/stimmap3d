"""Compare Python's cited anchors to the committed Node dataset without writing it."""
import json
from pathlib import Path
from generate_trials import build

expected = json.loads((Path(__file__).resolve().parents[1] / "web/src/data/trials.json").read_text(encoding="utf-8"))
actual = build()
assert actual["synthetic"] is True
assert actual["shamBaseline"] == expected["shamBaseline"]
assert {p["id"] for p in actual["protocols"]} == {p["id"] for p in expected["protocols"]}
for generated in actual["protocols"]:
    shipped = next(p for p in expected["protocols"] if p["id"] == generated["id"])
    for key in ["rates", "odds", "arm", "cohortSize"]:
        assert generated[key] == shipped[key], (generated["id"], key)
    assert len(generated["patients"]) == len(shipped["patients"])
print("Python clinical anchors match all committed protocols; synthetic draws use a different RNG.")
