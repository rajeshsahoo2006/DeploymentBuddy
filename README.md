# Deployment Buddy

A Model Context Protocol (MCP) based tool for managing Salesforce Einstein Bot and GenAI metadata deployments. Works as both a VS Code extension and a standalone MCP server for Cursor IDE integration.

## Features

- **Bot Browser**: Browse Einstein Bots, Bot Versions, and GenAI assets (Functions, Plugins, Planners)
- **Dependency Analysis**: Automatically detect Apex class and Flow dependencies
- **Smart Deploy Plans**: Build ordered deployment batches following Salesforce's dependency rules
- **Batched Deployment**: Execute deployments in the correct order with detailed logging
- **Cursor AI Integration**: Let Cursor AI analyze, plan, and execute deployments via MCP tools

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Editor Clients                            │
│  ┌──────────────────┐              ┌──────────────────┐         │
│  │  VS Code Extension│              │    Cursor IDE    │         │
│  │  (Webview UI)     │              │  (MCP Client)    │         │
│  └────────┬─────────┘              └────────┬─────────┘         │
└───────────┼─────────────────────────────────┼───────────────────┘
            │           stdio                  │
            └──────────────┬───────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                     MCP Server                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐          │
│  │ MCP Tools   │  │ SF CLI       │  │ Dependency     │          │
│  │ Layer       │──│ Wrapper      │──│ Graph          │          │
│  └─────────────┘  └──────────────┘  └────────────────┘          │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ Salesforce  │
                    │ CLI (sf)    │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │ Salesforce  │
                    │ Org         │
                    └─────────────┘
```

## Installation

### Prerequisites

- Node.js 18+
- Salesforce CLI (`sf`) installed and authenticated
- VS Code 1.85+ (for extension) or Cursor IDE (for MCP integration)

### Build from Source

```bash
# Clone and install dependencies
cd DeploymentBuddy
npm install

# Build everything
npm run build

# Or build separately
npm run build:server    # MCP server only
npm run build:extension # VS Code extension only
```

### Install VS Code Extension

```bash
# Package as .vsix
npm run package

# Install in VS Code
code --install-extension deployment-buddy-1.0.0.vsix
```

## Usage

### VS Code Extension

1. Open Command Palette (`Cmd/Ctrl+Shift+P`)
2. Run `Deployment Buddy: Start MCP Server`
3. Run `Deployment Buddy: Open Bot Deployer`

The UI allows you to:
- Browse Bots and GenAI assets
- Select items for deployment
- View detected dependencies
- Build and execute deployment plans

### Cursor IDE (MCP Integration)

See the `cursor-setup/CURSOR_SETUP.md` file for detailed instructions.

Quick setup:

1. Build the server: `npm run build:server`
2. Create `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "deployment-buddy": {
      "command": "node",
      "args": ["/path/to/DeploymentBuddy/dist/server/index.js"],
      "env": {
        "SF_PROJECT_PATH": "/path/to/salesforce/project",
        "SF_DEFAULT_ORG": "your-org-alias"
      }
    }
  }
}
```

3. Ask Cursor: "Analyze my bots and create a deployment plan"

## MCP Tools Reference

| Tool | Description |
|------|-------------|
| `get_org_alias` | Get connected Salesforce org info |
| `ensure_package_xml` | Create package.xml manifest |
| `retrieve_metadata` | Retrieve metadata from org |
| `list_bots` | List all Einstein Bots |
| `list_bot_versions` | List versions for a bot |
| `list_genai_assets` | List GenAI Functions/Plugins/Planners |
| `analyze_references` | Find Apex/Flow dependencies |
| `build_deploy_plan` | Create ordered deployment batches |
| `deploy_batch` | Deploy a single batch |
| `deploy_plan` | Execute full deployment plan |

## Deployment Order

Deployment Buddy enforces Salesforce's required deployment order:

1. **ApexClass** - Base classes first, then dependent classes
2. **Flow** - If referenced by GenAI components
3. **GenAiFunction** - Invocable actions
4. **GenAiPlugin** - Groups of functions
5. **GenAiPlanner** - AI orchestration
6. **Bot** - Einstein Bot configuration
7. **BotVersion** - Always deployed last

## Configuration

### VS Code Settings

```json
{
  "deploymentBuddy.salesforceProjectPath": "/path/to/project",
  "deploymentBuddy.defaultOrg": "my-org-alias",
  "deploymentBuddy.autoStart": false
}
```

### Environment Variables (MCP Server)

| Variable | Description |
|----------|-------------|
| `SF_PROJECT_PATH` | Salesforce project root path |
| `SF_DEFAULT_ORG` | Default org alias for CLI commands |

## Project Structure

```
DeploymentBuddy/
├── src/
│   ├── server/                 # MCP Server
│   │   ├── index.ts           # Entry point
│   │   ├── types.ts           # Type definitions
│   │   └── services/          # Core services
│   │       ├── salesforce-cli.ts
│   │       ├── metadata-parser.ts
│   │       └── dependency-graph.ts
│   └── extension/              # VS Code Extension
│       ├── extension.ts       # Entry point
│       ├── mcp-manager.ts     # MCP client
│       └── webview/           # UI
├── cursor-setup/              # Cursor configuration
├── dist/                      # Built output
└── package.json
```

## Development

```bash
# Watch mode for development
npm run watch

# Run tests
npm test

# Lint code
npm run lint
```

## Troubleshooting

### "Salesforce CLI not found"
Ensure `sf` is installed and in your PATH:
```bash
sf --version
```

### "No default org set"
Authenticate and set a default org:
```bash
sf org login web --set-default
```

### "Metadata not found"
Run retrieval first:
```bash
sf project retrieve start --manifest manifest/package.xml
```

## License

MIT
