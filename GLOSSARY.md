# Chat agent

A chat agent that answers with live web search and remembers what it said, when, and on what evidence, so it can tell the user whether an earlier answer still holds.

## Names

**TrueYet**:
The name of this agent: it answers "is what you told me still true?"
_Avoid_: The bot, the assistant

**The Savvy Paws**:
The four dogs in the interface (Biscuit, Scout, Bones, Watch), one per kind of work.
_Avoid_: The pack (in anything a user reads; fine in code)

## Conversation

**User**:
The one person talking to the agent. Has a home timezone that gives dates like "Monday" their meaning.
_Avoid_: Account, client

**Thread**:
One continuous chat in the UI. Memory is shared across all of a user's threads.
_Avoid_: Session, chat (as a noun for the container)

**Turn**:
One message in a thread, from the user or the agent, stamped with the moment it was sent.
_Avoid_: Message (when the timestamp matters), exchange

## Memory

**Entity**:
A real-world thing the user cares about and the agent can search for, such as a product, company or vendor.
_Avoid_: Topic, item

**Claim**:
A single checkable statement the agent made about an entity (for example a price or a limit), together with when it was true and the source that said so.
_Avoid_: Fact (a claim can turn out wrong), memory

**As-of**:
The moment a claim was observed to be true. Not the moment it was stored, and not the source's publish date.
_Avoid_: Timestamp, date

**Superseded claim**:
A claim that a newer claim about the same entity and attribute has replaced. It is kept, because "what did you tell me then?" must stay answerable.
_Avoid_: Deleted, stale

**Collection**:
A named group of entities the user formed in conversation, such as "the 5 CRMs we shortlisted".
_Avoid_: List, shortlist (as the general term), set

**Recall window**:
The span of time a user's words point at ("last Tuesday", "3 November"), resolved in the user's timezone.
_Avoid_: Date filter, range

## Answering

**Tier**:
How much work a user turn needs, from plain chat to recall, lookup, research or recheck.
_Avoid_: Mode, intent

**Recheck**:
Verifying earlier claims against the web today and giving each a verdict.
_Avoid_: Refresh, re-search

**Verdict**:
The outcome of rechecking one claim: changed, unchanged or unverified.
_Avoid_: Status, result

**Now**:
The moment the agent treats as the present. Normally the real time, but it can be fixed so memory can be tested across days.
_Avoid_: Current time, today (as a technical term)
