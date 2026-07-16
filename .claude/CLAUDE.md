# CLAUDE.md

## Fixed contract files
Files marked with a header comment like "FIXED CONTRACT — do not modify" or "FIXED TEST FIXTURE — do not modify" define an interface or test suite you must satisfy, not edit. If one of these files has an issue that blocks you (a syntax error, a missing type, anything that prevents compilation or test execution), STOP and ask before touching it. State exactly what's wrong and what you'd change, then wait for confirmation. Do not silently edit it, and do not simply give up and leave the task incomplete without asking.

## No fabricated APIs, flags, or config options
Do not invent compiler options, config keys, CLI flags, or library APIs based on what sounds plausible. If you're not certain a config option or API exists, verify it against the actual installed version (check `node_modules`, run `--help`, check the lockfile version) before using it. If you can't verify it, say so explicitly rather than guessing.

## Fix root causes, not symptoms
When something breaks, prefer the fix that prevents the problem from recurring over the fix that makes the current error message go away. If you already applied a quick workaround (e.g. deleting a generated folder, clearing a cache) to unblock yourself, go back afterward and apply the permanent fix too (e.g. excluding that folder from the tool that shouldn't scan it), and mention both in your summary.

## Report exactly what you did, not just that it worked
After any fix or implementation task, your summary must include:
1. The exact diff or change you made (not a paraphrase of it).
2. The full, real output of the verification command you ran (test output, compiler output, etc.) — not a claim that it passed.
Do not say something "works" or "is fixed" without showing the actual command output that demonstrates it.

## Type fidelity
When a fixed contract file defines a type (e.g. a result/return interface), use that exact type for anything that should conform to it — don't fall back to `any` or a looser type even if it happens to satisfy the shape at present. If the return type doesn't match, fix the implementation to match the type, not the other way around.