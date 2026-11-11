# Local SQLite with date-first, keyword retrieval (no vector database)

Memory lives in one SQLite file on disk using Node's built-in `node:sqlite` (no native build step, so `npm install` works everywhere) and FTS5 for keyword search. Retrieval filters by recall window first, then ranks by keyword and entity match. A single user's memory is small, dates are the strongest signal in this dataset, and keeping memory local means it never leaves the machine.

## Considered Options

- **Hosted vector database**: an extra service and API key, and it sends the user's memory off the machine.
- **Local embeddings in v1**: better fuzzy recall, but adds a large model download and dependency for little gain once entities and keywords are extracted. Left as a later improvement.
