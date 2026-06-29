# transform.py notes

Switched the cohort aggregate from a plain `.sum()` to an explicit agg so churn
is a mean, not a sum:

    df.groupby("cohort").agg({"users": "sum", "churn": "mean"})

Tests: `pytest -q` → 4 passed.
