# Security policy

## Project status

leepr is a student challenge entry built for the IBM AI Builders Challenge. It has
no production deployment, no user accounts, and stores no personal data. There is
no live instance that needs emergency patching. This policy exists so that anyone
who finds something knows where to send it.

## Supported versions

Only the current `main` branch is maintained.

## Reporting a vulnerability

Please **do not open a public GitHub issue** for a security finding.

Use GitHub's private vulnerability reporting instead:
<https://github.com/mspriing/leepr/security/advisories/new>

That opens a private draft advisory visible only to repository maintainers. Include
as much detail as you can: the affected file or endpoint, a description of the
impact, and steps to reproduce.

## Response expectation

Given the project's scope (a challenge entry, no production users), aim to
acknowledge reports within **7 days** and to provide a fix or disposition within
**30 days**. If the finding does not affect a deployed system, the fix may be
committed without urgency.

## Scope

The backend exposes two HTTP endpoints (`POST /estimate` and `GET /health`) with
no authentication. Both are documented as public. They accept JSON input validated
by Zod schemas and call IBM watsonx with credentials held in environment variables
that are never sent to the client. Client-side JavaScript has no access to any API
key or secret.

Out-of-scope: vulnerabilities in transitive npm dependencies that have no
exploitable path in this application, and theoretical attacks against the Google
Fonts CDN used to load IBM Plex typefaces.
