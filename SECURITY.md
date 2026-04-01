# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in NCLEX Trainer, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please email: **dimitri.derose@gmail.com**

Include:

- A description of the vulnerability
- Steps to reproduce
- The potential impact
- Any suggested fixes (optional)

## What to Expect

- **Acknowledgment:** Within 48 hours of your report
- **Assessment:** Within 1 week, we'll assess severity and share our plan
- **Fix:** Critical vulnerabilities will be patched as quickly as possible
- **Credit:** We'll credit you in the fix commit (unless you prefer anonymity)

## Scope

The following are in scope:

- Authentication and authorization bypasses
- SQL injection or other injection attacks
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Sensitive data exposure
- Server-side request forgery (SSRF)
- Insecure direct object references

The following are out of scope:

- Denial of service attacks
- Social engineering
- Issues in third-party dependencies (report these upstream)
- Issues that require physical access to the server

## Security Measures

NCLEX Trainer implements:

- JWT authentication with HTTP-only cookies
- Bcrypt password hashing
- Rate limiting on all API endpoints
- Input validation on all user inputs
- CSRF protection
- SQL injection prevention via JPA parameterized queries
- Audit logging of security-relevant events
- Role-based access control (USER, ADMIN)
