# Dates are resolved in code, and "now" can be fixed

Phrases like "last Tuesday" are resolved by chrono-node against the user's timezone and the agent's notion of now, not by the model. Now comes from one clock that can be fixed with the `NOW` env var or an `X-Now` request header, so seeded multi-day histories and the eval suite can time-travel deterministically. Models are unreliable at calendar arithmetic, and the dataset is built on exactly these phrases.
