"""Mixed-effects view of the controlled results.

For each judge: delta = R7(variant) - R7(unchanged parent) ~ perturbation, with a random intercept per
repo, so PRs from the same repo don't count as independent evidence.
"""
from __future__ import annotations

import warnings

import numpy as np
import pandas as pd

from jbc.schemas import Item, Rating


def deltas(items: list[Item], ratings: list[Rating]) -> pd.DataFrame:
    r7 = {r.item_id: r.overall for r in ratings}
    rows = []
    for it in items:
        base = r7.get(f"{it.parent_id}::none")
        if it.perturbation == "none" or it.id not in r7 or base is None:
            continue
        rows.append({"perturbation": it.perturbation, "repo": it.parent_id.split("#")[0],
                     "delta": r7[it.id] - base})
    return pd.DataFrame(rows)


def perturbation_effects(df: pd.DataFrame) -> dict:
    import statsmodels.formula.api as smf

    if df.empty or df["repo"].nunique() < 3:
        return {}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        fit = smf.mixedlm("delta ~ C(perturbation) - 1", df, groups=df["repo"]).fit(reml=True)
    ci = fit.conf_int()
    out = {}
    for name, val in fit.fe_params.items():
        p = name.split("[")[1].rstrip("]")
        out[p] = {"value": float(val), "lo": float(ci.loc[name, 0]), "hi": float(ci.loc[name, 1]),
                  "n": int((df["perturbation"] == p).sum())}
    re_var = float(np.asarray(fit.cov_re)[0, 0]) if fit.cov_re.size else 0.0
    out["_repo_sd"] = float(np.sqrt(max(re_var, 0.0)))
    out["_resid_sd"] = float(np.sqrt(fit.scale))
    return out
