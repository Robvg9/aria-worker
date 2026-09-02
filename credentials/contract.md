# ARIA Credential / Secret Boundary — Block A / A1

## Purpose
Provide the only control-plane boundary through which a credential reference may be resolved for an authorized adapter operation. This layer does not mint, store, rotate, select, or display secrets.

## Input
A canonical `credential_ref` must use the reference form `secret://<provider>/<account>` and contain no credential material.

## Rules
- Raw API keys, bearer tokens, passwords, private keys, service-role keys, cookies, or credential-shaped values are rejected as inputs.
- Environment-variable access is forbidden in this boundary.
- A credential may only be resolved after the caller has already passed governance/authorization checks; this module does not grant authorization.
- Resolution is dependency-injected. No concrete secret store is embedded in this repository.
- A secret may be passed only to a transport callback and may not be returned as application data, registry data, events, errors, or logs.
- Unknown/missing resolver evidence fails closed.
- Resolver errors are sanitized before crossing the boundary.

## API boundary
`createCredentialBoundary({ resolve })` returns:
- `validateRef(credential_ref)`
- `withCredential(credential_ref, context, transport)`
- `sanitizeError(error)`

`withCredential` invokes the injected resolver only for a valid reference and passes the resolved secret to the injected transport callback. The secret is never returned by the boundary.

## Production status
Design-controlled. A concrete persistent secret store and live resolver remain future infrastructure. No secret is present in this repository.
