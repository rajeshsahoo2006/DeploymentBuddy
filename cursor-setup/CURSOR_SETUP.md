# Cursor MCP Integration Guide

This guide explains how to use Deployment Buddy with Cursor IDE via the Model Context Protocol (MCP).

## Setup

### 1. Build the MCP Server

First, build the Deployment Buddy MCP server:

```bash
cd /path/to/DeploymentBuddy
npm install
npm run build:server
```

### 2. Configure Cursor MCP

There are two ways to configure MCP servers in Cursor:

#### Option A: Project-level Configuration

Create a `.cursor/mcp.json` file in your Salesforce project root:

```json
{
  "mcpServers": {
    "deployment-buddy": {
      "command": "node",
      "args": [
        "/absolute/path/to/DeploymentBuddy/dist/server/index.js"
      ],
      "env": {
        "SF_PROJECT_PATH": "/absolute/path/to/your/salesforce/project",
        "SF_DEFAULT_ORG": "your-org-alias"
      }
    }
  }
}
```

#### Option B: Global Configuration

Add to your global Cursor MCP configuration (usually `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "deployment-buddy": {
      "command": "node",
      "args": [
        "/absolute/path/to/DeploymentBuddy/dist/server/index.js"
      ],
      "env": {
        "SF_PROJECT_PATH": "/absolute/path/to/your/salesforce/project",
        "SF_DEFAULT_ORG": "your-org-alias"
      }
    }
  }
}
```

### 3. Verify Connection

1. Open Cursor IDE
2. Open the MCP panel (View > MCP Servers or use Command Palette)
3. You should see "deployment-buddy" listed as a connected server
4. The server's tools should be visible and callable

## Available MCP Tools

Once connected, Cursor AI can use these tools:

### Organization & Setup

| Tool | Description |
|------|-------------|
| `get_org_alias` | Get connected Salesforce org info |
| `ensure_package_xml` | Create package.xml manifest for retrieval |
| `retrieve_metadata` | Retrieve metadata from Salesforce org |

### Browsing Metadata

| Tool | Description |
|------|-------------|
| `list_bots` | List all Einstein Bots in the project |
| `list_bot_versions` | List versions for a specific bot |
| `list_genai_assets` | List GenAI Functions, Plugins, Planners |

### Analysis

| Tool | Description |
|------|-------------|
| `analyze_references` | Find Apex/Flow dependencies for a component |
| `build_deploy_plan` | Create an ordered deployment plan |

### Deployment

| Tool | Description |
|------|-------------|
| `deploy_batch` | Deploy a single batch of components |
| `deploy_plan` | Execute a full deployment plan |

## Example Cursor Workflows

### Workflow 1: Analyze and Deploy a Bot

Ask Cursor:

> "Analyze Einstein_Bot_1 and prepare a deployment plan"

Cursor will:
1. Call `list_bots()` to find the bot
2. Call `analyze_references("Bot", "Einstein_Bot_1")` to find dependencies
3. Recursively analyze each dependency
4. Call `build_deploy_plan([...])` with all required components
5. Present the plan for your approval

Then ask:

> "Deploy this plan"

Cursor will call `deploy_plan(plan)` to execute the deployment.

### Workflow 2: Explore GenAI Assets

Ask Cursor:

> "What GenAI planners and functions do we have? Show me what Apex classes they depend on."

Cursor will:
1. Call `list_genai_assets("GenAiPlanner")` and `list_genai_assets("GenAiFunction")`
2. For each asset, call `analyze_references()` to find Apex dependencies
3. Summarize the findings

### Workflow 3: Retrieve Latest Metadata

Ask Cursor:

> "Set up the project and retrieve all bot metadata from the org"

Cursor will:
1. Call `ensure_package_xml()` to create the manifest
2. Call `retrieve_metadata(manifestPath)` to pull metadata

### Workflow 4: Troubleshoot Deployment

If a deployment fails, ask:

> "The deployment failed. What went wrong and how can I fix it?"

Cursor will analyze the error logs and suggest fixes based on:
- Missing dependencies
- Version mismatches
- Circular references
- Permission issues

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `SF_PROJECT_PATH` | Path to your Salesforce project root | Yes |
| `SF_DEFAULT_ORG` | Default org alias for CLI commands | No |

## Troubleshooting

### Server Not Connecting

1. Check that Node.js is installed and in PATH
2. Verify the path to `dist/server/index.js` is correct
3. Check Cursor's MCP logs for errors

### Tools Not Appearing

1. Restart Cursor after changing MCP configuration
2. Check that the server built successfully
3. Verify the MCP configuration JSON is valid

### Salesforce CLI Errors

1. Ensure `sf` CLI is installed and authenticated
2. Check that `SF_PROJECT_PATH` points to a valid SFDX project
3. Verify org authentication with `sf org display`

## Best Practices

1. **Use specific org aliases** - Set `SF_DEFAULT_ORG` to avoid confusion
2. **Keep paths absolute** - Relative paths can cause issues
3. **Review plans before deploying** - Always check `build_deploy_plan` output
4. **Use checkOnly first** - Validate deployments before committing
