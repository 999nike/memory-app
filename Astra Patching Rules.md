# ASTRA PATCHING RULES

These rules are mandatory when GPT-6 Astra is working in this repository.

## 1. ONE TEST PER PROBLEM / PART

For each individual problem, feature part, or patch:

- Make the smallest correct implementation.
- Run AT MOST ONE automated verification after the change.
- Never run a sequence of tests.
- Never repeat a test.
- Never broaden testing after a successful test.
- Never run lint + unit tests + build + browser checks as a verification chain.
- Do not create additional test files unless the user explicitly requests them.

For a browser-visible/UI change, prefer ONE full browser/functional check as the single verification.

For a non-browser change, choose ONE focused verification that gives the most useful evidence.

Do not run both browser testing and command-line testing unless the user explicitly asks.

After the single verification, STOP.

If the verification passes, report the result and STOP for human testing.

If the verification fails, report exactly what failed and STOP for human review. Do not automatically patch and retest.

The USER decides whether another test or another patch cycle is required.

## 2. HUMAN TEST GATE

After completing one problem or one clearly separable part:

1. Implement it.
2. Perform the one permitted verification.
3. Summarize what changed.
4. State what was verified.
5. STOP and ask the user to perform the human test.

Do not continue into the next problem or part until the user tells you to continue.

## 3. PATCH, DO NOT REWRITE

Prefer the smallest robust diff.

- Inspect the existing implementation first.
- Reuse existing architecture, utilities and patterns.
- Do not redesign working architecture unless explicitly requested.
- Do not refactor unrelated code.
- Do not rename unrelated files/functions.
- Do not introduce new dependencies without a real requirement.
- Preserve existing behaviour outside the requested change.
- Do not clean up unrelated code merely because you noticed it.

## 4. INVESTIGATION IS NOT TESTING

Read-only inspection is allowed before editing:

- inspect relevant source files;
- search the repository;
- inspect git diff/status/log;
- read AGENTS.md and relevant documentation;
- trace functions and data flow;
- inspect existing nearby tests to understand intended behaviour.

Do not confuse investigation with permission to execute test suites.

## 5. SCOPE

Work on ONE requested problem or clearly defined part at a time.

If the request contains several parts, complete only the current part unless the user explicitly authorizes the whole batch.

Do not turn a contained patch into an autonomous end-to-end project.

## 6. REPORTING

At the end of each patch report only:

- root cause or purpose;
- files changed;
- what changed;
- the ONE verification performed and its result;
- anything the human should specifically check.

Then STOP FOR HUMAN TESTING.