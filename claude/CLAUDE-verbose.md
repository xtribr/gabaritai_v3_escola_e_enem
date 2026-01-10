## Git Workflow

- Do not include Claude Code or any irrelevant markers in commit messages.
- Every commit message should clearly explain what was changed and why it matters. Think of it as the subject line of a news story: brief, but complete enough to stand alone.



## Coding Guidelines

TypeScript / JavaScript
- Never use `any`. It weakens type safety. Avoid `as` unless there is no other option.
- Favor end-to-end type safety. Trust the compiler to infer types whenever possible.
- Use named exports. Default exports are allowed only in rare cases where they simplify integration.
- Do not create an `index.ts` whose only purpose is to re-export. It hides structure instead of clarifying it.
- Prefer async/await over chaining `.then()`. It reads more like plain English and reduces nesting.
- Unused variables should not exist. If you must declare one, prefix it with `_` to signal intent.
- Use string literals instead of concatenation. This avoids brittle code and improves readability.
- Avoid abbreviations. Names should be descriptive, not cryptic.
- Use early returns instead of long if-else chains. They cut through clutter.
- Prefer object lookups (hash maps) over switch statements for clarity and extensibility.
- Follow established conventions: SNAKE\_CAPS for constants, camelCase for variables and functions, kebab-case for filenames.

React
- Keep components pure. Do not define constants or functions inside them. Components should describe UI, not manage logic.
- Never fetch data in useEffect. Use React Query for data fetching and caching.
- Do not use raw strings for cache keys. Use enums or factories to centralize them.
- Avoid magic numbers and strings. Extract them into constants or enums.
- Prefer Suspense and useSuspenseQuery for async data handling instead of isLoading flags.
- Wrap data fetching with an error boundary that includes a retry option. This improves resilience.


## Software Engineering
- No premature optimization. Optimize only when performance is measured and proven problematic.
- Prioritize type safety, observability, accessibility (WCAG 2.0), and security (OWASP). These are not optional extras.
- Comments are often a sign of unclear code. Convert them into meaningful names, functions, or variables instead.
- Do not write raw SQL strings. Use query builders for type safety and injection protection.
- Use higher-order functions to wrap cross-cutting concerns like monitoring, error handling, and profiling.


## Testing
- Always test behavior, not implementation details. Tests should read like specifications of what the system does, not how it does it.
- Do not write test names with “should.” Use verbs that describe outcomes: “returns error when unauthorized.”
- Every bug fix must be accompanied by a regression test. A bug without a test is an invitation to return.
- Use describe blocks liberally to group tests into coherent behaviors.
- Remember that tests are documentation. Future readers will learn how the system is supposed to behave by reading them.


## Writing
- Cut the unnecessary words. Be concise. Do not waste the reader’s time.
- Prefer active voice: “We fixed the bug” instead of “The bug was fixed.”
- Keep sentences short. One idea per sentence.
- Lead with the result, then explain supporting details.
- When comments exist, they should explain why code is written a certain way, never what the code already says.

## Naming
Clarity Above All
Code is thinking made visible. If your naming is fuzzy, your thinking is fuzzy. Use names that tell the truth. Avoid empty words like data, item, list, info, component.
Example: userPaymentDeadline is clear. dataList is meaningless.

Simplicity
Names should be short but clear. Do not over-engineer or create verbose monsters. Avoid cleverness or jokes.
Example: retryCount is enough. maximumNumberOfTimesToRetryBeforeGivingUpOnTheRequest is a burden.

Brevity
Every character should earn its place. Remove redundancy. Avoid suffixes like Manager, Helper, or Service unless they convey real distinctions.
Example: users is fine. userListDataItems is clutter.

Specificity
Be concrete. retryAfterMs is clearer than timeout. emailValidator is safer than validator. Specific names prevent misuse.

Respect the Craft
Naming, refactoring, and documentation are not busywork. They are design in miniature. Code is a form of writing. Write it the way you would write prose: clear, simple, and built to last.