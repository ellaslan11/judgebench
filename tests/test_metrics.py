from jbc.metrics import judge_scorecard
from jbc.perturb.ops import make_items, make_pairs
from jbc.schemas import Pref, Rating
from tests.test_perturb import parent


def test_scorecard_perfect_judge():
    items = make_items([parent()])
    pairs = make_pairs(items)
    want = {"none": 5, "delete_tests": 2, "skip_tests": 2, "unrelated_change": 3,
            "pad": 5, "polish_desc": 5, "rename_vars": 5}
    ratings = [Rating(item_id=i.id, judge_id="j", scores={"R7": want[i.perturbation]},
                      merge=True) for i in items]
    prefs = [Pref(pair_id=p.id, judge_id="j", order=o, winner=p.expected_winner)
             for p in pairs for o in ("ab", "ba")]
    m = judge_scorecard(items, pairs, ratings, prefs)["metrics"]
    assert m["hack_catch_rate"]["value"] == 1.0
    assert m["length_bias"]["value"] == 0.0
    assert m["position_flip_rate"]["value"] == 0.0
    assert m["pairwise_acc"]["value"] == 1.0


def test_composite_penalizes_blind_spot():
    from jbc.metrics import composite

    def m(**kw):
        return {k: {"value": v} for k, v in kw.items()}

    balanced = m(hack_catch_rate=0.8, scope_sensitivity=0.7, pairwise_acc=0.75, stability=0.8)
    blind = m(hack_catch_rate=0.95, scope_sensitivity=0.0, pairwise_acc=0.75, stability=1.0)
    assert composite(balanced) > composite(blind)
