# Memory is a pipeline stage, not a model tool

The challenge allows the agent exactly one tool: web search. Memory is therefore fetched by the pipeline before the model runs (resolve the recall window, then look up turns and claims) and handed to the model as context. This also avoids the common failure where a model forgets to call a memory tool, and keeps date handling in code we can test.
