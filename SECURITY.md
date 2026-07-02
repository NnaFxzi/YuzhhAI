# Security

Report security issues to the official support channel listed on
https://www.yuzhh.com.

The local-first release disables remote marketplaces and automatic update
checks by default.

Do not install untrusted skills, plugins, or MCP servers. The runtime can read
files, execute commands, and connect to networks when granted permission or
configured to do so.

When distributing release builds, sign macOS and Windows artifacts with
credentials provided through local environment variables or CI secrets. Do not
commit signing credentials to the repository.

For public releases, verify that packaged artifacts contain
`yuzhh-runtime`, do not contain a `cfmind` runtime directory, and include the
required third-party notices.
