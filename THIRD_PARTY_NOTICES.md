# Third-party notices

RepoHarbor's service wrapper and documentation are distributed under the MIT
license in [LICENSE](LICENSE). The wrapper was initially developed in a local
WeKnora workspace as Code Atlas; the original MIT copyright notice is retained
in LICENSE. RepoHarbor runs independently and does not include the WeKnora
application or GitNexus code.

| Component | Pinned version | License | Upstream |
| --- | --- | --- | --- |
| `@lzehrung/codegraph` | 3.0.0 | MIT | https://github.com/lzehrung/codegraph |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT | https://github.com/modelcontextprotocol/typescript-sdk |

Codegraph provides the native parser, indexes and code graph tools. RepoHarbor
adds GitLab synchronization, immutable snapshot publishing, the administrator
interface, graph browsing and repository-scoped HTTP MCP access.

The full dependency graph, registry URLs and integrity values are recorded in
`package-lock.json`. The Docker image retains dependency license files and
Codegraph's own third-party notices under `/app/node_modules`. The pinned
Node/Debian base image retains its component notices. The application license
and this notice are also copied into `/app`.

The graph viewer serves Codegraph's bundled Graphology, Sigma.js and ForceAtlas2
assets locally from `/app/node_modules/@lzehrung/codegraph/src/viewer/vendor`.
Their `LICENSE.graphology.txt`, `LICENSE.sigma.txt` and
`LICENSE.graphology-layout-forceatlas2.txt` files are retained alongside the
bundles. No public CDN or remote font service is needed at runtime.
