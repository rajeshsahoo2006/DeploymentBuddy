# Deployment Buddy

A Model Context Protocol (MCP) based tool for managing Salesforce Einstein Bot and GenAI metadata deployments. Works as both a VS Code extension and a standalone MCP server for Cursor IDE integration.

## Features

- **Bot Browser**: Browse Einstein Bots, Bot Versions, and GenAI assets (Functions, Plugins, Planners)
- **Bot Version Selection**: Automatically detect and prompt for Bot version selection when multiple versions exist
- **Dependency Analysis**: Automatically detect Apex class and Flow dependencies (including transitive dependencies)
- **Smart Deploy Plans**: Build ordered deployment batches following Salesforce's dependency rules
- **Batch Validation**: Validate deployments batch-by-batch with cumulative package.xml files
- **Package.xml Generation**: Automatically create `package_1.xml`, `package_2.xml`, etc. for each batch
- **CLI Command Generation**: Generate copy-paste ready SF CLI commands for manual validation
- **CLI Output Analyzer**: Paste Salesforce CLI output to analyze errors, missing metadata, and get suggestions
- **Auto-Retrieval**: Automatically retrieve missing Custom Objects and Custom Fields from org during validation
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
- Select Bot versions when multiple versions exist
- Select items for deployment
- View detected dependencies (including transitive dependencies)
- Build deployment plans with proper ordering
- Validate deployments batch-by-batch
- View generated package.xml files and copy SF CLI commands
- Analyze Salesforce CLI output for errors and suggestions

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
| `get_org_alias` | Get connected Salesforce org info (including API version) |
| `ensure_package_xml` | Create package.xml manifest |
| `retrieve_metadata` | Retrieve metadata from org |
| `list_bots` | List all Einstein Bots |
| `list_bot_versions` | List versions for a bot |
| `list_genai_assets` | List GenAI Functions/Plugins/Planners |
| `list_apex_classes` | List all Apex classes in local project |
| `list_flows` | List all Flows in local project |
| `analyze_references` | Find direct Apex/Flow dependencies |
| `analyze_all_dependencies` | Find all transitive dependencies recursively |
| `build_deploy_plan` | Create ordered deployment batches with dependency resolution |
| `validate_plan` | Validate deployment plan batch-by-batch with auto-retrieval |
| `validate_batch` | Validate a single batch (for timeout recovery) |
| `analyze_cli_output` | Parse and analyze Salesforce CLI output for errors |
| `deploy_batch` | Deploy a single batch |
| `deploy_plan` | Execute full deployment plan |

## Deployment Order

Deployment Buddy enforces Salesforce's required deployment order:

1. **ApexClass** - Base classes first, then dependent classes (topologically sorted)
2. **Flow** - If referenced by GenAI components
3. **GenAiFunction** - Invocable actions
4. **GenAiPlugin** - Groups of functions
5. **GenAiPlanner** - AI orchestration
6. **Bot** - Einstein Bot configuration
7. **BotVersion** - Always deployed last

## Validation Workflow

### Batch-by-Batch Validation

When you click **Validate**, Deployment Buddy:

1. **Creates Package.xml Files**: Generates `manifest/package_1.xml`, `package_2.xml`, etc. in your project root
   - Each file contains cumulative components (batch 1, then batch 1+2, then batch 1+2+3, etc.)
   - Uses your org's API version dynamically

2. **Validates Sequentially**: Validates each batch in order using cumulative components

3. **Auto-Retrieval**: If validation fails due to missing Custom Objects or Custom Fields:
   - Automatically retrieves missing metadata from the org
   - Adds it to your local project
   - Retries validation (up to 3 retries per batch)

4. **Generates CLI Commands**: Provides copy-paste ready commands for manual validation:
   ```bash
   sf project deploy validate --manifest "manifest/package_1.xml" --target-org your-org-alias
   sf project deploy validate --manifest "manifest/package_2.xml" --target-org your-org-alias
   ```

### CLI Output Analyzer

Paste any Salesforce CLI output (JSON or plain text) into the analyzer to:
- Extract and summarize errors
- Identify missing metadata components
- Get suggestions for fixing issues
- Understand deployment failures

## Bot Version Selection

When selecting a Bot with multiple versions:
1. Deployment Buddy detects multiple versions
2. Shows a modal to select the specific version
3. Uses the selected `BotVersion` for dependency analysis
4. Includes both the `Bot` and selected `BotVersion` in the deployment plan

## Dependency Resolution

Deployment Buddy performs comprehensive dependency analysis:

- **Direct Dependencies**: Finds Apex classes and Flows directly referenced by GenAI components
- **Transitive Dependencies**: Recursively finds all dependencies of dependencies
- **Local File Checking**: Only includes dependencies that exist in your local project
- **Missing Dependency Warnings**: Alerts you when dependencies are referenced but not found locally

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
│   │   ├── index.ts           # Entry point, MCP tools
│   │   ├── types.ts           # Type definitions
│   │   └── services/          # Core services
│   │       ├── salesforce-cli.ts    # SF CLI wrapper, package.xml generation
│   │       ├── metadata-parser.ts   # XML parsing, dependency extraction
│   │       └── dependency-graph.ts  # Dependency resolution, batch ordering
│   └── extension/              # VS Code Extension
│       ├── extension.ts       # Entry point
│       ├── mcp-manager.ts     # MCP client, timeout handling
│       └── webview/           # UI
│           └── panel.ts       # Webview HTML/JS, validation UI
├── cursor-setup/              # Cursor configuration
├── manifest/                  # Generated package.xml files (created during validation)
├── dist/                      # Built output
└── package.json
```

## Generated Files

During validation, Deployment Buddy creates:

- `manifest/package_1.xml` - Batch 1 components
- `manifest/package_2.xml` - Batch 1 + Batch 2 components (cumulative)
- `manifest/package_3.xml` - Batch 1 + Batch 2 + Batch 3 components (cumulative)
- etc.

Each package.xml file uses your org's API version and can be used for manual validation or deployment.

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

### "Dependencies not found locally"
- Check that the referenced Apex classes or Flows exist in your project
- Use the dependency panel to see which dependencies are missing
- Consider retrieving missing dependencies from the org

### "Validation timeout"
- The MCP protocol has a 60-second timeout limit
- Package.xml files are still created - use the generated CLI commands to validate manually
- Or use the `validate_batch` tool to validate batches individually

### "API Version mismatch"
- Deployment Buddy automatically detects your org's API version
- If you see version errors, ensure your metadata files match the org's API version
- The generated package.xml files use your org's API version automatically

### "Missing Custom Object/Field errors"
- Deployment Buddy automatically retrieves missing Custom Objects and Custom Fields during validation
- Check the validation results to see what was retrieved
- If auto-retrieval fails, manually retrieve using:
  ```bash
  sf project retrieve start --metadata CustomObject:YourObject__c
  ```

## License

MIT
