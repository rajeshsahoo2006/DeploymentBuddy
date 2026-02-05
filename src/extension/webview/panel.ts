/**
 * Deployment Buddy Webview Panel
 * Provides the HTML UI for bot browsing and deployment
 */

import * as vscode from 'vscode';
import { McpManager } from '../mcp-manager';

export class DeploymentBuddyPanel {
  public static currentPanel: DeploymentBuddyPanel | undefined;
  public static readonly viewType = 'deploymentBuddy';

  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _mcpManager: McpManager;
  private _disposables: vscode.Disposable[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    mcpManager: McpManager
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._mcpManager = mcpManager;

    // Set the webview's initial html content
    this._update();

    // Handle messages from the webview
    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        await this._handleMessage(message);
      },
      null,
      this._disposables
    );

    // Handle disposal
    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static createOrShow(extensionUri: vscode.Uri, mcpManager: McpManager) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    // If we already have a panel, show it
    if (DeploymentBuddyPanel.currentPanel) {
      DeploymentBuddyPanel.currentPanel._panel.reveal(column);
      return;
    }

    // Create a new panel
    const panel = vscode.window.createWebviewPanel(
      DeploymentBuddyPanel.viewType,
      'Deployment Buddy',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist'),
          vscode.Uri.joinPath(extensionUri, 'src', 'extension', 'webview', 'ui')
        ]
      }
    );

    DeploymentBuddyPanel.currentPanel = new DeploymentBuddyPanel(
      panel,
      extensionUri,
      mcpManager
    );
  }

  private async _handleMessage(message: any) {
    switch (message.command) {
      case 'refresh':
        await this._refreshData();
        break;
      
      case 'getOrgInfo':
        const orgResult = await this._mcpManager.callTool('get_org_alias');
        this._panel.webview.postMessage({
          command: 'orgInfo',
          data: orgResult.data,
          error: orgResult.error
        });
        break;

      case 'listBots':
        const botsResult = await this._mcpManager.callTool('list_bots');
        this._panel.webview.postMessage({
          command: 'botsData',
          data: botsResult.data,
          error: botsResult.error
        });
        break;

      case 'listBotVersions':
        const versionsResult = await this._mcpManager.callTool('list_bot_versions', {
          botName: message.botName
        });
        this._panel.webview.postMessage({
          command: 'botVersionsData',
          botName: message.botName,
          data: versionsResult.data,
          error: versionsResult.error
        });
        break;

      case 'listGenAiAssets':
        const assetsResult = await this._mcpManager.callTool('list_genai_assets', {
          type: message.type
        });
        this._panel.webview.postMessage({
          command: 'genAiAssetsData',
          data: assetsResult.data,
          error: assetsResult.error
        });
        break;

      case 'listApexClasses':
        const apexResult = await this._mcpManager.callTool('list_apex_classes');
        this._panel.webview.postMessage({
          command: 'apexClassesData',
          data: apexResult.data,
          error: apexResult.error
        });
        break;

      case 'listFlows':
        const flowsResult = await this._mcpManager.callTool('list_flows');
        this._panel.webview.postMessage({
          command: 'flowsData',
          data: flowsResult.data,
          error: flowsResult.error
        });
        break;

      case 'listOrgs':
        const orgsResult = await this._mcpManager.callTool('list_orgs');
        this._panel.webview.postMessage({
          command: 'orgsData',
          data: orgsResult.data,
          error: orgsResult.error
        });
        break;

      case 'setTargetOrg':
        const setOrgResult = await this._mcpManager.callTool('set_target_org', {
          targetOrg: message.targetOrg
        });
        this._panel.webview.postMessage({
          command: 'targetOrgSet',
          data: setOrgResult.data,
          error: setOrgResult.error
        });
        // Refresh org info after setting target
        if (setOrgResult.success) {
          await this._handleMessage({ command: 'getOrgInfo' });
        }
        break;

      case 'analyzeReferences':
        const refsResult = await this._mcpManager.callTool('analyze_references', {
          assetType: message.assetType,
          assetName: message.assetName
        });
        this._panel.webview.postMessage({
          command: 'referencesData',
          assetType: message.assetType,
          assetName: message.assetName,
          data: refsResult.data,
          error: refsResult.error
        });
        break;

      case 'analyzeAllDependencies':
        this._panel.webview.postMessage({ command: 'analyzingDependencies', assetName: message.assetName });
        const allDepsResult = await this._mcpManager.callTool('analyze_all_dependencies', {
          assetType: message.assetType,
          assetName: message.assetName
        });
        this._panel.webview.postMessage({
          command: 'allDependenciesData',
          assetType: message.assetType,
          assetName: message.assetName,
          data: allDepsResult.data,
          error: allDepsResult.error
        });
        break;

      case 'buildDeployPlan':
        const planResult = await this._mcpManager.callTool('build_deploy_plan', {
          selection: message.selection
        });
        this._panel.webview.postMessage({
          command: 'deployPlanData',
          data: planResult.data,
          error: planResult.error
        });
        break;

      case 'deployPlan':
        this._panel.webview.postMessage({
          command: 'deployStarted'
        });
        
        const deployResult = await this._mcpManager.callTool('deploy_plan', {
          plan: message.plan,
          checkOnly: false  // Always false for actual deployment
        });
        
        this._panel.webview.postMessage({
          command: 'deployResult',
          data: deployResult.data,
          error: deployResult.error
        });
        break;

      case 'validatePlan':
        try {
          this._panel.webview.postMessage({
            command: 'validationStarted'
          });
          
          // Validate plan structure
          if (!message.plan) {
            throw new Error('No plan provided. Please build a plan first.');
          }
          
          if (!message.plan.batches || !Array.isArray(message.plan.batches)) {
            throw new Error('Invalid plan structure. Please rebuild the plan.');
          }
          
          this._mcpManager.getOutputChannel().appendLine(`Validating plan with ${message.plan.batches.length} batches...`);
          
          const validateResult = await this._mcpManager.callTool('validate_plan', {
            plan: message.plan
          });
          
          this._mcpManager.getOutputChannel().appendLine(`Validation result: ${validateResult.success ? 'Success' : 'Failed'}`);
          if (validateResult.error) {
            this._mcpManager.getOutputChannel().appendLine(`Error: ${validateResult.error}`);
          }
          
          this._panel.webview.postMessage({
            command: 'validationResult',
            data: validateResult.data,
            error: validateResult.error
          });
        } catch (error: any) {
          const errorMessage = error.message || 'Unknown error occurred during validation';
          this._mcpManager.getOutputChannel().appendLine(`Validation error: ${errorMessage}`);
          this._panel.webview.postMessage({
            command: 'validationResult',
            data: null,
            error: errorMessage
          });
        }
        break;

      case 'analyzeCliOutput':
        const analyzeResult = await this._mcpManager.callTool('analyze_cli_output', {
          output: message.output
        });
        
        this._panel.webview.postMessage({
          command: 'cliAnalysisResult',
          data: analyzeResult.data,
          error: analyzeResult.error
        });
        break;

      case 'ensurePackageXml':
        this._panel.webview.postMessage({ command: 'retrieveStatus', status: 'creating_package' });
        const packageResult = await this._mcpManager.callTool('ensure_package_xml', {
          path: message.path
        });
        this._panel.webview.postMessage({
          command: 'packageXmlResult',
          data: packageResult.data,
          error: packageResult.error
        });
        break;

      case 'retrieveMetadata':
        this._panel.webview.postMessage({ command: 'retrieveStatus', status: 'retrieving' });
        const retrieveResult = await this._mcpManager.callTool('retrieve_metadata', {
          manifestPath: message.manifestPath
        });
        this._panel.webview.postMessage({
          command: 'retrieveResult',
          data: retrieveResult.data,
          error: retrieveResult.error
        });
        // After successful retrieve, refresh the metadata list
        if (retrieveResult.success) {
          await this._refreshData();
        }
        break;
    }
  }

  private async _refreshData() {
    // Refresh all data
    await this._handleMessage({ command: 'getOrgInfo' });
    await this._handleMessage({ command: 'listBots' });
    await this._handleMessage({ command: 'listGenAiAssets' });
    await this._handleMessage({ command: 'listApexClasses' });
    await this._handleMessage({ command: 'listFlows' });
    await this._handleMessage({ command: 'listOrgs' });
  }

  private _update() {
    this._panel.title = 'Deployment Buddy';
    this._panel.webview.html = this._getHtmlContent();
  }

  private _getHtmlContent(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Deployment Buddy</title>
    <style>
        :root {
            --vscode-font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
        }
        
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        
        body {
            font-family: var(--vscode-font-family);
            padding: 20px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }
        
        .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
            padding-bottom: 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .header h1 {
            font-size: 1.5em;
            font-weight: 600;
        }
        
        .org-info {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 0.9em;
            color: var(--vscode-descriptionForeground);
        }
        
        .org-badge {
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 3px 8px;
            border-radius: 10px;
            font-size: 0.85em;
        }
        
        .org-select {
            padding: 4px 8px;
            border-radius: 4px;
            background: var(--vscode-dropdown-background);
            color: var(--vscode-dropdown-foreground);
            border: 1px solid var(--vscode-dropdown-border);
            font-size: 0.85em;
            min-width: 200px;
            cursor: pointer;
        }
        
        .org-select:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        
        .main-container {
            display: grid;
            grid-template-columns: 300px 1fr;
            gap: 20px;
            height: calc(100vh - 140px);
        }
        
        .sidebar {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }
        
        .sidebar-header {
            background: var(--vscode-sideBar-background);
            padding: 12px 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .sidebar-content {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
        }
        
        .tree-item {
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 4px;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .tree-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .tree-item.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        
        .tree-item-icon {
            width: 16px;
            text-align: center;
        }
        
        .tree-item-children {
            margin-left: 20px;
        }
        
        .tree-item-expandable::before {
            content: '▶';
            font-size: 0.7em;
            margin-right: 5px;
        }
        
        .tree-item-expandable.expanded::before {
            content: '▼';
        }
        
        .content-area {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        
        .panel {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
        }
        
        .panel-header {
            background: var(--vscode-sideBar-background);
            padding: 12px 15px;
            border-bottom: 1px solid var(--vscode-panel-border);
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .panel-content {
            padding: 15px;
            max-height: 300px;
            overflow-y: auto;
        }
        
        .btn {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 0.9em;
            display: inline-flex;
            align-items: center;
            gap: 6px;
        }
        
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .btn-sm {
            padding: 4px 10px;
            font-size: 0.8em;
        }
        
        .btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        .actions {
            display: flex;
            gap: 10px;
            flex-wrap: wrap;
        }
        
        .dependency-item {
            padding: 8px 12px;
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 4px;
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        
        .dependency-type {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
        }
        
        .batch-item {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            margin-bottom: 10px;
            overflow: hidden;
        }
        
        .batch-header {
            background: var(--vscode-editor-inactiveSelectionBackground);
            padding: 10px 15px;
            font-weight: 500;
            display: flex;
            justify-content: space-between;
        }
        
        .batch-items {
            padding: 10px 15px;
        }
        
        .batch-item-entry {
            padding: 5px 0;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .status-indicator {
            width: 8px;
            height: 8px;
            border-radius: 50%;
        }
        
        .status-pending { background: var(--vscode-charts-yellow); }
        .status-running { background: var(--vscode-charts-blue); }
        .status-success { background: var(--vscode-charts-green); }
        .status-error { background: var(--vscode-charts-red); }
        
        .log-output {
            background: var(--vscode-terminal-background);
            color: var(--vscode-terminal-foreground);
            padding: 15px;
            font-family: monospace;
            font-size: 0.85em;
            max-height: 200px;
            overflow-y: auto;
            border-radius: 4px;
        }
        
        .log-line {
            margin-bottom: 3px;
        }
        
        .log-error {
            color: var(--vscode-errorForeground);
        }
        
        .log-success {
            color: var(--vscode-charts-green);
        }
        
        .empty-state {
            text-align: center;
            padding: 40px 20px;
            color: var(--vscode-descriptionForeground);
        }
        
        .empty-state h3 {
            margin-bottom: 10px;
            color: var(--vscode-foreground);
        }
        
        .empty-state p {
            margin-bottom: 20px;
        }
        
        .loading {
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            gap: 10px;
        }
        
        .spinner {
            width: 20px;
            height: 20px;
            border: 2px solid var(--vscode-foreground);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .retrieve-panel {
            background: var(--vscode-editor-inactiveSelectionBackground);
            border-radius: 8px;
            padding: 30px;
            text-align: center;
            margin: 20px 0;
        }
        
        .retrieve-panel h3 {
            margin-bottom: 15px;
        }
        
        .retrieve-panel p {
            margin-bottom: 20px;
            color: var(--vscode-descriptionForeground);
        }
        
        .retrieve-steps {
            text-align: left;
            margin: 20px 0;
            padding: 15px;
            background: var(--vscode-editor-background);
            border-radius: 6px;
        }
        
        .retrieve-step {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 0;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .retrieve-step:last-child {
            border-bottom: none;
        }
        
        .step-number {
            width: 28px;
            height: 28px;
            border-radius: 50%;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 0.9em;
        }
        
        .step-number.done {
            background: var(--vscode-charts-green);
        }
        
        .step-number.active {
            background: var(--vscode-charts-blue);
        }
        
        .step-content {
            flex: 1;
        }
        
        .step-title {
            font-weight: 500;
        }
        
        .step-desc {
            font-size: 0.85em;
            color: var(--vscode-descriptionForeground);
        }
        
        .alert {
            padding: 12px 15px;
            border-radius: 6px;
            margin-bottom: 15px;
        }
        
        .alert-info {
            background: var(--vscode-inputValidation-infoBackground);
            border: 1px solid var(--vscode-inputValidation-infoBorder);
        }
        
        .alert-warning {
            background: var(--vscode-inputValidation-warningBackground);
            border: 1px solid var(--vscode-inputValidation-warningBorder);
        }
        
        /* Version Selection Modal */
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            justify-content: center;
            align-items: center;
        }
        
        .modal-overlay.active {
            display: flex;
        }
        
        .modal {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            min-width: 350px;
            max-width: 500px;
            box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }
        
        .modal-header {
            font-size: 1.1em;
            font-weight: 600;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        
        .modal-body {
            margin-bottom: 20px;
        }
        
        .version-list {
            max-height: 200px;
            overflow-y: auto;
        }
        
        .version-item {
            padding: 10px 12px;
            cursor: pointer;
            border-radius: 4px;
            margin-bottom: 5px;
            display: flex;
            align-items: center;
            gap: 10px;
            background: var(--vscode-editor-inactiveSelectionBackground);
        }
        
        .version-item:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .version-item.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        
        .version-radio {
            width: 16px;
            height: 16px;
        }
        
        .modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }
        
        /* CLI Output Analyzer */
        textarea {
            font-family: 'Courier New', monospace;
            resize: vertical;
        }
        
        textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        
        #cliAnalysisResult h3, #cliAnalysisResult h4 {
            margin-top: 0;
            margin-bottom: 10px;
        }
        
        #cliAnalysisResult h3 {
            font-size: 1.1em;
        }
        
        #cliAnalysisResult h4 {
            font-size: 1em;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Deployment Buddy</h1>
        <div class="org-info">
            <span>Target Org:</span>
            <select class="org-select" id="orgSelect" onchange="changeTargetOrg(this.value)">
                <option value="">Loading orgs...</option>
            </select>
            <span class="org-badge" id="orgBadge">Loading...</span>
            <button class="btn btn-secondary btn-sm" onclick="refresh()">Refresh</button>
        </div>
    </div>
    
    <!-- Retrieve Metadata Section (shown when no metadata) -->
    <div id="retrieveSection" style="display: none;">
        <div class="retrieve-panel">
            <h3>Retrieve Metadata from Salesforce</h3>
            <p>No metadata found locally. Retrieve metadata from your org to get started.</p>
            
            <div class="retrieve-steps">
                <div class="retrieve-step" id="step1">
                    <div class="step-number" id="step1Num">1</div>
                    <div class="step-content">
                        <div class="step-title">Create package.xml</div>
                        <div class="step-desc">Generate manifest file with Bot and GenAI metadata types</div>
                    </div>
                </div>
                <div class="retrieve-step" id="step2">
                    <div class="step-number" id="step2Num">2</div>
                    <div class="step-content">
                        <div class="step-title">Retrieve from Org</div>
                        <div class="step-desc">Run the retrieve command in your terminal (shown below)</div>
                    </div>
                </div>
                <div class="retrieve-step" id="step3">
                    <div class="step-number" id="step3Num">3</div>
                    <div class="step-content">
                        <div class="step-title">Load Metadata</div>
                        <div class="step-desc">Click "Load Metadata" when retrieval is complete</div>
                    </div>
                </div>
            </div>
            
            <div id="commandSection" style="display: none; margin: 20px 0;">
                <div class="alert alert-info">
                    <strong>Run this command in your terminal:</strong>
                    <div style="margin-top: 10px; padding: 12px; background: var(--vscode-terminal-background); border-radius: 4px; font-family: monospace; font-size: 0.9em; word-break: break-all;">
                        <span id="retrieveCommand"></span>
                        <button class="btn btn-secondary btn-sm" style="margin-left: 10px;" onclick="copyCommand()">Copy</button>
                    </div>
                </div>
            </div>
            
            <div class="actions" style="justify-content: center; gap: 15px;">
                <button class="btn btn-primary" id="generateBtn" onclick="generatePackageXml()">
                    1. Generate package.xml
                </button>
                <button class="btn btn-primary" id="loadBtn" onclick="loadMetadata()" disabled>
                    3. Load Metadata
                </button>
            </div>
            <div id="retrieveStatus" style="margin-top: 15px; display: none;"></div>
        </div>
    </div>
    
    <!-- Main Content (shown when metadata exists) -->
    <div class="main-container" id="mainContent">
        <div class="sidebar">
            <div class="sidebar-header">
                <span>Metadata Browser</span>
                <button class="btn btn-secondary btn-sm" onclick="showRetrieveSection()" title="Retrieve from Org">Retrieve</button>
            </div>
            <div class="sidebar-content" id="metadataTree">
                <div class="loading">
                    <div class="spinner"></div>
                    <span>Loading metadata...</span>
                </div>
            </div>
        </div>
        
        <div class="content-area">
            <div class="panel">
                <div class="panel-header">
                    <span>Selection & Dependencies</span>
                    <div class="actions">
                        <button class="btn btn-primary btn-sm" id="autoSelectBtn" onclick="analyzeAndSelectDependencies()">Auto-select Dependencies</button>
                        <button class="btn btn-secondary btn-sm" onclick="selectAll()">Select All</button>
                        <button class="btn btn-secondary btn-sm" onclick="clearSelection()">Clear</button>
                    </div>
                </div>
                <div class="panel-content" id="dependenciesPanel">
                    <div class="empty-state">
                        <p>Select a Bot or GenAI asset, then click <strong>"Auto-select Dependencies"</strong> to automatically find all required Apex classes, Flows, and other components.</p>
                    </div>
                </div>
            </div>
            
            <div class="panel">
                <div class="panel-header">
                    <span>Deployment Plan</span>
                    <div class="actions">
                        <button class="btn btn-secondary btn-sm" onclick="buildPlan()" id="buildPlanBtn">Build Plan</button>
                        <button class="btn btn-secondary btn-sm" onclick="validatePlan()" id="validateBtn" disabled>Validate</button>
                        <button class="btn btn-primary btn-sm" onclick="deployPlan()" id="deployBtn" disabled>Deploy</button>
                    </div>
                </div>
                <div class="panel-content" id="deployPlanPanel">
                    <div class="empty-state">
                        Select items and click "Build Plan" to create a deployment plan
                    </div>
                </div>
            </div>
            
            <div class="panel">
                <div class="panel-header">
                    <span>CLI Output Analyzer</span>
                    <button class="btn btn-secondary btn-sm" onclick="clearCliOutput()">Clear</button>
                </div>
                <div class="panel-content">
                    <div style="margin-bottom: 10px;">
                        <p style="color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 10px;">
                            Paste your Salesforce CLI output here (JSON or text) to analyze errors and get suggestions.
                        </p>
                        <textarea id="cliOutputInput" placeholder="Paste CLI output here (e.g., sf project deploy validate --json output)..." style="width: 100%; min-height: 150px; padding: 10px; font-family: monospace; font-size: 0.85em; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); border-radius: 4px; resize: vertical;"></textarea>
                    </div>
                    <div class="actions">
                        <button class="btn btn-primary" onclick="analyzeCliOutput()">Analyze Output</button>
                    </div>
                    <div id="cliAnalysisResult" style="margin-top: 15px; display: none;"></div>
                </div>
            </div>
            
            <div class="panel">
                <div class="panel-header">
                    <span>Logs</span>
                    <button class="btn btn-secondary btn-sm" onclick="clearLogs()">Clear</button>
                </div>
                <div class="log-output" id="logOutput">
                    <div class="log-line">Ready for deployment...</div>
                </div>
            </div>
        </div>
    </div>
    
    <!-- Version Selection Modal -->
    <div class="modal-overlay" id="versionModal">
        <div class="modal">
            <div class="modal-header">Select Bot Version</div>
            <div class="modal-body">
                <p style="margin-bottom: 15px; color: var(--vscode-descriptionForeground);">
                    This bot has multiple versions. Please select the version you want to deploy:
                </p>
                <div class="version-list" id="versionList">
                    <!-- Versions will be populated here -->
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeVersionModal()">Cancel</button>
                <button class="btn btn-primary" id="selectVersionBtn" onclick="confirmVersionSelection()" disabled>Select Version</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        
        // State
        let bots = [];
        let genAiAssets = [];
        let apexClasses = [];
        let flows = [];
        let orgs = [];
        let selectedItems = new Set();
        let currentPlan = null;
        let orgInfo = null;
        let targetOrg = null;
        let isRetrieving = false;
        
        // Version selection state
        let pendingBotSelection = null;  // Bot waiting for version selection
        let selectedVersion = null;      // Currently selected version in modal
        
        // Initialize
        window.addEventListener('load', () => {
            refresh();
        });
        
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.command) {
                case 'orgInfo':
                    if (message.data) {
                        orgInfo = message.data;
                        document.getElementById('orgBadge').textContent = 
                            message.data.alias || message.data.username || 'Unknown';
                    } else if (message.error) {
                        document.getElementById('orgBadge').textContent = 'Not connected';
                    }
                    break;
                    
                case 'botsData':
                    if (message.data) {
                        bots = message.data.bots || [];
                        checkMetadataAndRender();
                    }
                    break;
                    
                case 'botVersionsData':
                    const bot = bots.find(b => b.name === message.botName);
                    if (bot && message.data) {
                        bot.versions = message.data.versions || [];
                        renderMetadataTree();
                        
                        // If this is a pending bot selection, show version modal
                        if (pendingBotSelection && pendingBotSelection.name === message.botName) {
                            if (bot.versions.length > 0) {
                                showVersionModal(bot);
                            } else {
                                // No versions found, just select the bot
                                completeBotSelection(pendingBotSelection.name, null, pendingBotSelection.element);
                            }
                        }
                    }
                    break;
                    
                case 'genAiAssetsData':
                    if (message.data) {
                        genAiAssets = message.data.assets || [];
                        checkMetadataAndRender();
                    }
                    break;
                    
                case 'apexClassesData':
                    if (message.data) {
                        apexClasses = message.data.classes || [];
                        checkMetadataAndRender();
                    }
                    break;
                    
                case 'flowsData':
                    if (message.data) {
                        flows = message.data.flows || [];
                        checkMetadataAndRender();
                    }
                    break;
                    
                case 'orgsData':
                    if (message.data) {
                        orgs = message.data.orgs || [];
                        renderOrgSelector();
                    }
                    break;
                    
                case 'targetOrgSet':
                    if (message.data) {
                        targetOrg = message.data.org;
                        log('Target org set to: ' + (targetOrg?.alias || targetOrg?.username), 'success');
                    } else if (message.error) {
                        log('Error setting target org: ' + message.error, 'error');
                    }
                    break;
                    
                case 'referencesData':
                    if (message.data) {
                        renderDependencies(message.data);
                    }
                    break;
                    
                case 'analyzingDependencies':
                    log('Analyzing dependencies for: ' + message.assetName + '...', 'info');
                    document.getElementById('autoSelectBtn').disabled = true;
                    document.getElementById('autoSelectBtn').textContent = 'Analyzing...';
                    break;
                    
                case 'allDependenciesData':
                    document.getElementById('autoSelectBtn').disabled = false;
                    document.getElementById('autoSelectBtn').textContent = 'Auto-select Dependencies';
                    if (message.data) {
                        autoSelectDependencies(message.data);
                    } else if (message.error) {
                        log('Error analyzing dependencies: ' + message.error, 'error');
                    }
                    break;
                    
                case 'deployPlanData':
                    if (message.data) {
                        currentPlan = message.data.plan;
                        renderDeployPlan(message.data);
                        document.getElementById('validateBtn').disabled = false;
                        document.getElementById('deployBtn').disabled = false;
                    } else if (message.error) {
                        log('Error building plan: ' + message.error, 'error');
                    }
                    break;
                    
                case 'deployStarted':
                    log('Deployment started...', 'info');
                    document.getElementById('deployBtn').disabled = true;
                    break;
                    
                case 'deployResult':
                    if (message.data) {
                        renderDeployResult(message.data);
                    } else if (message.error) {
                        log('Deployment error: ' + message.error, 'error');
                    }
                    document.getElementById('deployBtn').disabled = false;
                    break;
                
                case 'validationStarted':
                    log('Validation started...', 'info');
                    break;
                    
                case 'validationResult':
                    document.getElementById('validateBtn').disabled = false;
                    document.getElementById('validateBtn').textContent = 'Validate';
                    if (message.data) {
                        renderValidationResult(message.data);
                    } else if (message.error) {
                        log('❌ Validation error: ' + message.error, 'error');
                        // Show error in a more visible way
                        const errorDiv = document.createElement('div');
                        errorDiv.style.cssText = 'padding: 15px; margin: 10px 0; background: var(--vscode-inputValidation-errorBackground); border-left: 3px solid var(--vscode-errorForeground); border-radius: 4px;';
                        errorDiv.innerHTML = '<strong>Validation Failed</strong><br>' + message.error;
                        const planPanel = document.getElementById('deployPlanPanel');
                        if (planPanel) {
                            planPanel.insertBefore(errorDiv, planPanel.firstChild);
                        }
                    } else {
                        log('Validation completed but no result data received', 'warning');
                    }
                    break;
                
                case 'cliAnalysisResult':
                    if (message.data) {
                        renderCliAnalysis(message.data);
                    } else if (message.error) {
                        log('Analysis error: ' + message.error, 'error');
                        document.getElementById('cliAnalysisResult').style.display = 'block';
                        document.getElementById('cliAnalysisResult').innerHTML = 
                            '<div style="color: var(--vscode-errorForeground);">Error analyzing output: ' + message.error + '</div>';
                    }
                    break;
                
                case 'retrieveStatus':
                    updateRetrieveStatus(message.status);
                    break;
                    
                case 'packageXmlResult':
                    if (message.data) {
                        log('package.xml created: ' + message.data.path, 'success');
                        updateStepStatus(1, 'done');
                        updateStepStatus(2, 'active');
                        
                        // Show the command to run
                        const manifestPath = message.data.path;
                        const cmd = 'sf project retrieve start --manifest "' + manifestPath + '"';
                        document.getElementById('retrieveCommand').textContent = cmd;
                        document.getElementById('commandSection').style.display = 'block';
                        document.getElementById('loadBtn').disabled = false;
                        document.getElementById('generateBtn').disabled = true;
                        document.getElementById('generateBtn').textContent = '✓ package.xml Created';
                        
                        document.getElementById('retrieveStatus').style.display = 'block';
                        document.getElementById('retrieveStatus').innerHTML = 
                            '<span style="color: var(--vscode-charts-yellow);">Now run the command above in your terminal, then click "Load Metadata"</span>';
                    } else if (message.error) {
                        log('Error creating package.xml: ' + message.error, 'error');
                        resetRetrieveUI();
                    }
                    break;
                    
                case 'retrieveResult':
                    // This is no longer used in the new async flow
                    break;
            }
        });
        
        function refresh() {
            vscode.postMessage({ command: 'getOrgInfo' });
            vscode.postMessage({ command: 'listBots' });
            vscode.postMessage({ command: 'listGenAiAssets' });
            vscode.postMessage({ command: 'listApexClasses' });
            vscode.postMessage({ command: 'listFlows' });
            vscode.postMessage({ command: 'listOrgs' });
        }
        
        function checkMetadataAndRender() {
            const hasMetadata = bots.length > 0 || genAiAssets.length > 0 || apexClasses.length > 0 || flows.length > 0;
            
            document.getElementById('retrieveSection').style.display = hasMetadata ? 'none' : 'block';
            document.getElementById('mainContent').style.display = hasMetadata ? 'grid' : 'none';
            
            if (hasMetadata) {
                renderMetadataTree();
            }
        }
        
        function renderOrgSelector() {
            const select = document.getElementById('orgSelect');
            let html = '<option value="">-- Select Target Org --</option>';
            
            for (const org of orgs) {
                const label = org.alias || org.username;
                const isDefault = org.isDefault ? ' (default)' : '';
                const isScratch = org.isScratch ? ' [scratch]' : '';
                const selected = (targetOrg && (targetOrg.alias === org.alias || targetOrg.username === org.username)) ? 'selected' : '';
                html += '<option value="' + org.username + '" ' + selected + '>' + label + isDefault + isScratch + '</option>';
            }
            
            select.innerHTML = html;
            
            // If there's a default org and no target set, select it
            if (!targetOrg) {
                const defaultOrg = orgs.find(o => o.isDefault);
                if (defaultOrg) {
                    select.value = defaultOrg.username;
                    targetOrg = defaultOrg;
                }
            }
        }
        
        function changeTargetOrg(username) {
            if (!username) return;
            
            log('Changing target org to: ' + username, 'info');
            vscode.postMessage({
                command: 'setTargetOrg',
                targetOrg: username
            });
        }
        
        function generatePackageXml() {
            document.getElementById('generateBtn').disabled = true;
            document.getElementById('generateBtn').textContent = 'Creating...';
            document.getElementById('retrieveStatus').style.display = 'block';
            document.getElementById('retrieveStatus').innerHTML = 
                '<div class="loading"><div class="spinner"></div><span>Creating package.xml...</span></div>';
            
            updateStepStatus(1, 'active');
            log('Creating package.xml...', 'info');
            
            vscode.postMessage({ command: 'ensurePackageXml' });
        }
        
        function loadMetadata() {
            log('Loading metadata from local files...', 'info');
            updateStepStatus(2, 'done');
            updateStepStatus(3, 'active');
            
            document.getElementById('retrieveStatus').innerHTML = 
                '<div class="loading"><div class="spinner"></div><span>Loading metadata...</span></div>';
            
            // Refresh the metadata lists
            refresh();
            
            // After a short delay, check if we got data
            setTimeout(() => {
                if (bots.length > 0 || genAiAssets.length > 0) {
                    updateStepStatus(3, 'done');
                    document.getElementById('retrieveStatus').innerHTML = 
                        '<span style="color: var(--vscode-charts-green);">Metadata loaded successfully!</span>';
                } else {
                    document.getElementById('retrieveStatus').innerHTML = 
                        '<span style="color: var(--vscode-charts-yellow);">No metadata found. Make sure the retrieve command completed successfully, then try again.</span>';
                }
            }, 2000);
        }
        
        function copyCommand() {
            const cmd = document.getElementById('retrieveCommand').textContent;
            navigator.clipboard.writeText(cmd).then(() => {
                log('Command copied to clipboard!', 'success');
            }).catch(() => {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = cmd;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                log('Command copied to clipboard!', 'success');
            });
        }
        
        function copyValidationCommand(batchNumber) {
            const cmdElement = document.getElementById('cmd' + batchNumber);
            if (!cmdElement) {
                log('Command not found', 'error');
                return;
            }
            
            const cmd = cmdElement.textContent || cmdElement.innerText;
            navigator.clipboard.writeText(cmd).then(() => {
                log('Validation command copied to clipboard!', 'success');
            }).catch(() => {
                // Fallback for older browsers
                const textarea = document.createElement('textarea');
                textarea.value = cmd;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                log('Validation command copied to clipboard!', 'success');
            });
        }
        
        function updateStepStatus(step, status) {
            const numEl = document.getElementById('step' + step + 'Num');
            numEl.className = 'step-number';
            if (status === 'done') {
                numEl.classList.add('done');
                numEl.textContent = '✓';
            } else if (status === 'active') {
                numEl.classList.add('active');
            }
        }
        
        function resetRetrieveUI() {
            ['step1Num', 'step2Num', 'step3Num'].forEach((id, i) => {
                const el = document.getElementById(id);
                el.className = 'step-number';
                el.textContent = (i + 1).toString();
            });
            document.getElementById('commandSection').style.display = 'none';
            document.getElementById('generateBtn').disabled = false;
            document.getElementById('generateBtn').textContent = '1. Generate package.xml';
            document.getElementById('loadBtn').disabled = true;
        }
        
        function showRetrieveSection() {
            resetRetrieveUI();
            document.getElementById('retrieveSection').style.display = 'block';
            document.getElementById('mainContent').style.display = 'none';
            document.getElementById('retrieveStatus').style.display = 'none';
        }
        
        function renderMetadataTree() {
            const container = document.getElementById('metadataTree');
            let html = '';
            
            // Apex Classes section
            html += '<div class="tree-section">';
            html += '<div class="tree-item tree-item-expandable" onclick="toggleSection(this)"><span class="tree-item-icon">📝</span>Apex Classes (' + apexClasses.length + ')</div>';
            html += '<div class="tree-item-children" style="display: none;">';
            for (const cls of apexClasses) {
                const isSelected = selectedItems.has('ApexClass:' + cls.name);
                html += '<div class="tree-item ' + (isSelected ? 'selected' : '') + '" onclick="toggleItem(this, \\'ApexClass\\', \\'' + cls.name + '\\')">';
                html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleItem(this.parentElement, \\'ApexClass\\', \\'' + cls.name + '\\')">';
                html += '<span>' + cls.name + '</span></div>';
            }
            if (apexClasses.length === 0) {
                html += '<div style="padding: 8px 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em;">No Apex classes found</div>';
            }
            html += '</div></div>';
            
            // Flows section
            html += '<div class="tree-section">';
            html += '<div class="tree-item tree-item-expandable" onclick="toggleSection(this)"><span class="tree-item-icon">🔄</span>Flows (' + flows.length + ')</div>';
            html += '<div class="tree-item-children" style="display: none;">';
            for (const flow of flows) {
                const isSelected = selectedItems.has('Flow:' + flow.name);
                const label = flow.label ? ' (' + flow.label + ')' : '';
                html += '<div class="tree-item ' + (isSelected ? 'selected' : '') + '" onclick="toggleItem(this, \\'Flow\\', \\'' + flow.name + '\\')">';
                html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleItem(this.parentElement, \\'Flow\\', \\'' + flow.name + '\\')">';
                html += '<span>' + flow.name + label + '</span></div>';
            }
            if (flows.length === 0) {
                html += '<div style="padding: 8px 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em;">No Flows found</div>';
            }
            html += '</div></div>';
            
            // Bots section
            html += '<div class="tree-section">';
            html += '<div class="tree-item tree-item-expandable expanded" onclick="toggleSection(this)"><span class="tree-item-icon">🤖</span>Bots (' + bots.length + ')</div>';
            html += '<div class="tree-item-children">';
            for (const bot of bots) {
                const isSelected = selectedItems.has('Bot:' + bot.name);
                html += '<div class="tree-item ' + (isSelected ? 'selected' : '') + '" onclick="toggleItem(this, \\'Bot\\', \\'' + bot.name + '\\')">';
                html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleItem(this.parentElement, \\'Bot\\', \\'' + bot.name + '\\')">';
                html += '<span>' + bot.name + '</span></div>';
            }
            if (bots.length === 0) {
                html += '<div style="padding: 8px 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em;">No bots found</div>';
            }
            html += '</div></div>';
            
            // GenAi Functions
            const functions = genAiAssets.filter(a => a.type === 'GenAiFunction');
            html += '<div class="tree-section">';
            html += '<div class="tree-item tree-item-expandable expanded" onclick="toggleSection(this)"><span class="tree-item-icon">⚡</span>GenAI Functions (' + functions.length + ')</div>';
            html += '<div class="tree-item-children">';
            for (const func of functions) {
                const isSelected = selectedItems.has('GenAiFunction:' + func.name);
                html += '<div class="tree-item ' + (isSelected ? 'selected' : '') + '" onclick="toggleItem(this, \\'GenAiFunction\\', \\'' + func.name + '\\')">';
                html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleItem(this.parentElement, \\'GenAiFunction\\', \\'' + func.name + '\\')">';
                html += '<span>' + func.name + '</span></div>';
            }
            if (functions.length === 0) {
                html += '<div style="padding: 8px 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em;">No functions found</div>';
            }
            html += '</div></div>';
            
            // GenAi Plugins
            const plugins = genAiAssets.filter(a => a.type === 'GenAiPlugin');
            html += '<div class="tree-section">';
            html += '<div class="tree-item tree-item-expandable expanded" onclick="toggleSection(this)"><span class="tree-item-icon">🔌</span>GenAI Plugins (' + plugins.length + ')</div>';
            html += '<div class="tree-item-children">';
            for (const plugin of plugins) {
                const isSelected = selectedItems.has('GenAiPlugin:' + plugin.name);
                html += '<div class="tree-item ' + (isSelected ? 'selected' : '') + '" onclick="toggleItem(this, \\'GenAiPlugin\\', \\'' + plugin.name + '\\')">';
                html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleItem(this.parentElement, \\'GenAiPlugin\\', \\'' + plugin.name + '\\')">';
                html += '<span>' + plugin.name + '</span></div>';
            }
            if (plugins.length === 0) {
                html += '<div style="padding: 8px 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em;">No plugins found</div>';
            }
            html += '</div></div>';
            
            // GenAi Planners
            const planners = genAiAssets.filter(a => a.type === 'GenAiPlannerBundle');
            html += '<div class="tree-section">';
            html += '<div class="tree-item tree-item-expandable expanded" onclick="toggleSection(this)"><span class="tree-item-icon">🧠</span>GenAI Planners (' + planners.length + ')</div>';
            html += '<div class="tree-item-children">';
            for (const planner of planners) {
                const isSelected = selectedItems.has('GenAiPlannerBundle:' + planner.name);
                html += '<div class="tree-item ' + (isSelected ? 'selected' : '') + '" onclick="toggleItem(this, \\'GenAiPlannerBundle\\', \\'' + planner.name + '\\')">';
                html += '<input type="checkbox" ' + (isSelected ? 'checked' : '') + ' onclick="event.stopPropagation(); toggleItem(this.parentElement, \\'GenAiPlannerBundle\\', \\'' + planner.name + '\\')">';
                html += '<span>' + planner.name + '</span></div>';
            }
            if (planners.length === 0) {
                html += '<div style="padding: 8px 12px; color: var(--vscode-descriptionForeground); font-size: 0.9em;">No planners found</div>';
            }
            html += '</div></div>';
            
            container.innerHTML = html;
        }
        
        function toggleSection(element) {
            element.classList.toggle('expanded');
            const children = element.nextElementSibling;
            if (children) {
                children.style.display = element.classList.contains('expanded') ? 'block' : 'none';
            }
        }
        
        function toggleItem(element, type, name) {
            const key = type + ':' + name;
            if (selectedItems.has(key)) {
                selectedItems.delete(key);
                element.classList.remove('selected');
                const checkbox = element.querySelector('input[type="checkbox"]');
                if (checkbox) checkbox.checked = false;
                
                // If deselecting a Bot, also remove its associated BotVersion
                if (type === 'Bot') {
                    const bot = bots.find(b => b.name === name);
                    if (bot && bot.versions) {
                        for (const version of bot.versions) {
                            selectedItems.delete('BotVersion:' + version.fullName);
                        }
                    }
                }
            } else {
                // Special handling for Bot selection - prompt for version
                if (type === 'Bot') {
                    const bot = bots.find(b => b.name === name);
                    
                    // Store pending selection
                    pendingBotSelection = { name, element };
                    
                    // If versions already loaded, show modal directly
                    if (bot && bot.versions && bot.versions.length > 0) {
                        showVersionModal(bot);
                    } else {
                        // Fetch versions first
                        log('Loading versions for ' + name + '...', 'info');
                        vscode.postMessage({
                            command: 'listBotVersions',
                            botName: name
                        });
                    }
                    return; // Don't complete selection yet
                }
                
                // Normal selection for non-Bot types
                selectedItems.add(key);
                element.classList.add('selected');
                const checkbox = element.querySelector('input[type="checkbox"]');
                if (checkbox) checkbox.checked = true;
                
                // Analyze references for this item
                vscode.postMessage({
                    command: 'analyzeReferences',
                    assetType: type,
                    assetName: name
                });
                
                // Show hint for auto-select if it's a GenAI asset
                if (type === 'GenAiPlannerBundle' || type === 'GenAiPlugin' || type === 'GenAiFunction') {
                    log('Tip: Click "Auto-select Dependencies" to find all required Apex classes and Flows for ' + name, 'info');
                }
            }
            updateDependenciesPanel();
        }
        
        function showVersionModal(bot) {
            const modal = document.getElementById('versionModal');
            const versionList = document.getElementById('versionList');
            selectedVersion = null;
            
            let html = '';
            for (const version of bot.versions) {
                const versionNum = version.versionNumber ? ' (v' + version.versionNumber + ')' : '';
                html += '<div class="version-item" onclick="selectVersion(this, \\'' + version.fullName + '\\')">';
                html += '<input type="radio" name="version" class="version-radio" value="' + version.fullName + '">';
                html += '<span>' + version.name + versionNum + '</span>';
                html += '</div>';
            }
            
            versionList.innerHTML = html;
            document.getElementById('selectVersionBtn').disabled = true;
            modal.classList.add('active');
        }
        
        function selectVersion(element, versionFullName) {
            // Remove selection from all items
            document.querySelectorAll('.version-item').forEach(item => {
                item.classList.remove('selected');
                item.querySelector('input').checked = false;
            });
            
            // Select this item
            element.classList.add('selected');
            element.querySelector('input').checked = true;
            selectedVersion = versionFullName;
            document.getElementById('selectVersionBtn').disabled = false;
        }
        
        function closeVersionModal() {
            document.getElementById('versionModal').classList.remove('active');
            pendingBotSelection = null;
            selectedVersion = null;
        }
        
        function confirmVersionSelection() {
            if (!selectedVersion || !pendingBotSelection) return;
            
            completeBotSelection(pendingBotSelection.name, selectedVersion, pendingBotSelection.element);
            closeVersionModal();
        }
        
        function completeBotSelection(botName, versionFullName, element) {
            // Add both Bot and BotVersion to selection
            selectedItems.add('Bot:' + botName);
            
            if (versionFullName) {
                selectedItems.add('BotVersion:' + versionFullName);
                log('Selected ' + botName + ' with version: ' + versionFullName, 'success');
            } else {
                log('Selected ' + botName + ' (no versions found)', 'info');
            }
            
            // Update UI
            if (element) {
                element.classList.add('selected');
                const checkbox = element.querySelector('input[type="checkbox"]');
                if (checkbox) checkbox.checked = true;
            }
            
            // Analyze references for the BotVersion (which contains the planner reference)
            // If no version, analyze the Bot itself
            const typeToAnalyze = versionFullName ? 'BotVersion' : 'Bot';
            const nameToAnalyze = versionFullName || botName;
            
            vscode.postMessage({
                command: 'analyzeReferences',
                assetType: typeToAnalyze,
                assetName: nameToAnalyze
            });
            
            log('Tip: Click "Auto-select Dependencies" to find all required components for ' + botName, 'info');
            
            pendingBotSelection = null;
            updateDependenciesPanel();
            renderMetadataTree();
        }
        
        function selectAll() {
            for (const cls of apexClasses) {
                selectedItems.add('ApexClass:' + cls.name);
            }
            for (const flow of flows) {
                selectedItems.add('Flow:' + flow.name);
            }
            for (const bot of bots) {
                selectedItems.add('Bot:' + bot.name);
            }
            for (const asset of genAiAssets) {
                selectedItems.add(asset.type + ':' + asset.name);
            }
            renderMetadataTree();
            updateDependenciesPanel();
        }
        
        function clearSelection() {
            selectedItems.clear();
            renderMetadataTree();
            updateDependenciesPanel();
            currentPlan = null;
            document.getElementById('deployPlanPanel').innerHTML = '<div class="empty-state">Select items and click "Build Plan" to create a deployment plan</div>';
            document.getElementById('validateBtn').disabled = true;
            document.getElementById('deployBtn').disabled = true;
        }
        
        function updateDependenciesPanel() {
            const container = document.getElementById('dependenciesPanel');
            
            if (selectedItems.size === 0) {
                container.innerHTML = '<div class="empty-state">Select items from the metadata browser to see dependencies</div>';
                return;
            }
            
            let html = '<div><strong>Selected Items (' + selectedItems.size + '):</strong></div>';
            for (const item of selectedItems) {
                const [type, ...nameParts] = item.split(':');
                const name = nameParts.join(':'); // Handle names that might contain ':'
                
                // Special display for BotVersion
                if (type === 'BotVersion') {
                    const [botName, versionName] = name.split('.');
                    html += '<div class="dependency-item"><span>' + botName + ' → ' + versionName + '</span><span class="dependency-type">' + type + '</span></div>';
                } else {
                    html += '<div class="dependency-item"><span>' + name + '</span><span class="dependency-type">' + type + '</span></div>';
                }
            }
            container.innerHTML = html;
        }
        
        function renderDependencies(data) {
            const container = document.getElementById('dependenciesPanel');
            if (data.details && data.details.length > 0) {
                let html = container.innerHTML;
                html += '<div style="margin-top: 15px;"><strong>Dependencies:</strong></div>';
                for (const ref of data.details) {
                    html += '<div class="dependency-item"><span>' + ref.targetName + '</span><span class="dependency-type">' + ref.targetType + ' (' + ref.referenceType + ')</span></div>';
                }
                container.innerHTML = html;
            }
        }
        
        function analyzeAndSelectDependencies() {
            // Find the first selected Bot/BotVersion or GenAI asset to analyze
            let assetToAnalyze = null;
            
            // First priority: Look for BotVersion (contains the planner reference)
            for (const item of selectedItems) {
                const [type, name] = item.split(':');
                if (type === 'BotVersion') {
                    assetToAnalyze = { type, name };
                    break;
                }
            }
            
            // Second priority: Look for Bot (will analyze all versions) or GenAI assets
            if (!assetToAnalyze) {
                for (const item of selectedItems) {
                    const [type, name] = item.split(':');
                    if (type === 'Bot' || type === 'GenAiPlannerBundle' || type === 'GenAiPlugin' || type === 'GenAiFunction') {
                        assetToAnalyze = { type, name };
                        break;
                    }
                }
            }
            
            if (!assetToAnalyze) {
                log('Please select a Bot or GenAI asset first to analyze dependencies', 'error');
                return;
            }
            
            log('Analyzing all dependencies for: ' + assetToAnalyze.name + ' (' + assetToAnalyze.type + ')', 'info');
            vscode.postMessage({
                command: 'analyzeAllDependencies',
                assetType: assetToAnalyze.type,
                assetName: assetToAnalyze.name
            });
        }
        
        function autoSelectDependencies(data) {
            let addedCount = 0;
            
            // Auto-select all discovered Apex classes
            if (data.apexClasses) {
                for (const cls of data.apexClasses) {
                    // Check if this class exists in our list
                    const exists = apexClasses.some(c => c.name === cls);
                    if (exists && !selectedItems.has('ApexClass:' + cls)) {
                        selectedItems.add('ApexClass:' + cls);
                        addedCount++;
                    }
                }
            }
            
            // Auto-select all discovered Flows
            if (data.flows) {
                for (const flow of data.flows) {
                    const exists = flows.some(f => f.name === flow);
                    if (exists && !selectedItems.has('Flow:' + flow)) {
                        selectedItems.add('Flow:' + flow);
                        addedCount++;
                    }
                }
            }
            
            // Auto-select all discovered GenAI Functions
            if (data.genAiFunctions) {
                for (const func of data.genAiFunctions) {
                    const exists = genAiAssets.some(a => a.type === 'GenAiFunction' && a.name === func);
                    if (exists && !selectedItems.has('GenAiFunction:' + func)) {
                        selectedItems.add('GenAiFunction:' + func);
                        addedCount++;
                    }
                }
            }
            
            // Auto-select all discovered GenAI Plugins
            if (data.genAiPlugins) {
                for (const plugin of data.genAiPlugins) {
                    const exists = genAiAssets.some(a => a.type === 'GenAiPlugin' && a.name === plugin);
                    if (exists && !selectedItems.has('GenAiPlugin:' + plugin)) {
                        selectedItems.add('GenAiPlugin:' + plugin);
                        addedCount++;
                    }
                }
            }
            
            // Auto-select all discovered GenAI Planners
            if (data.genAiPlannerBundles) {
                for (const planner of data.genAiPlannerBundles) {
                    const exists = genAiAssets.some(a => a.type === 'GenAiPlannerBundle' && a.name === planner);
                    if (exists && !selectedItems.has('GenAiPlannerBundle:' + planner)) {
                        selectedItems.add('GenAiPlannerBundle:' + planner);
                        addedCount++;
                    }
                }
            }
            
            // Update the UI
            renderMetadataTree();
            updateDependenciesPanel();
            
            // Show summary
            log(data.summary, 'success');
            log('Auto-selected ' + addedCount + ' additional components', 'success');
            
            // Update dependencies panel with detailed info
            const container = document.getElementById('dependenciesPanel');
            let html = '<div><strong>Dependency Analysis Complete</strong></div>';
            html += '<div style="margin: 10px 0; padding: 10px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 4px;">';
            html += '<div>' + data.summary + '</div>';
            html += '</div>';
            
            if (data.apexClasses && data.apexClasses.length > 0) {
                html += '<div style="margin-top: 10px;"><strong>Apex Classes (' + data.apexClasses.length + '):</strong></div>';
                for (const cls of data.apexClasses) {
                    const exists = apexClasses.some(c => c.name === cls);
                    const status = exists ? '✓' : '⚠️ Not found locally';
                    html += '<div class="dependency-item"><span>' + cls + '</span><span class="dependency-type">' + status + '</span></div>';
                }
            }
            
            if (data.flows && data.flows.length > 0) {
                html += '<div style="margin-top: 10px;"><strong>Flows (' + data.flows.length + '):</strong></div>';
                for (const flow of data.flows) {
                    const exists = flows.some(f => f.name === flow);
                    const status = exists ? '✓' : '⚠️ Not found locally';
                    html += '<div class="dependency-item"><span>' + flow + '</span><span class="dependency-type">' + status + '</span></div>';
                }
            }
            
            if (data.genAiFunctions && data.genAiFunctions.length > 0) {
                html += '<div style="margin-top: 10px;"><strong>GenAI Functions (' + data.genAiFunctions.length + '):</strong></div>';
                for (const func of data.genAiFunctions) {
                    html += '<div class="dependency-item"><span>' + func + '</span><span class="dependency-type">GenAiFunction</span></div>';
                }
            }
            
            if (data.genAiPlugins && data.genAiPlugins.length > 0) {
                html += '<div style="margin-top: 10px;"><strong>GenAI Plugins (' + data.genAiPlugins.length + '):</strong></div>';
                for (const plugin of data.genAiPlugins) {
                    html += '<div class="dependency-item"><span>' + plugin + '</span><span class="dependency-type">GenAiPlugin</span></div>';
                }
            }
            
            if (data.genAiPlannerBundles && data.genAiPlannerBundles.length > 0) {
                html += '<div style="margin-top: 10px;"><strong>GenAI Planners (' + data.genAiPlannerBundles.length + '):</strong></div>';
                for (const planner of data.genAiPlannerBundles) {
                    html += '<div class="dependency-item"><span>' + planner + '</span><span class="dependency-type">GenAiPlannerBundle</span></div>';
                }
            }
            
            container.innerHTML = html;
        }
        
        function buildPlan() {
            if (selectedItems.size === 0) {
                log('No items selected', 'error');
                return;
            }
            
            log('Building deployment plan...', 'info');
            vscode.postMessage({
                command: 'buildDeployPlan',
                selection: Array.from(selectedItems)
            });
        }
        
        function renderDeployPlan(data) {
            const container = document.getElementById('deployPlanPanel');
            const plan = data.plan;
            const summary = data.summary;
            
            // Store the plan for validation/deployment
            currentPlan = plan;
            
            // Log plan details for debugging
            console.log('Plan stored:', {
                batches: plan.batches?.length || 0,
                totalItems: plan.totalItems || 0,
                hasBatches: !!plan.batches,
                batchTypes: plan.batches?.map(b => b.metadataType) || []
            });
            
            let html = '<div style="margin-bottom: 15px;">';
            html += '<strong>Plan Summary:</strong> ' + summary.totalItems + ' items in ' + summary.totalBatches + ' batches';
            if (data.validation && !data.validation.valid) {
                html += '<div style="color: var(--vscode-errorForeground);">Validation errors: ' + data.validation.errors.join(', ') + '</div>';
            }
            html += '</div>';
            
            for (const batch of plan.batches) {
                html += '<div class="batch-item">';
                html += '<div class="batch-header">';
                html += '<span>Batch ' + batch.batchNumber + ': ' + batch.metadataType + '</span>';
                html += '<span>' + batch.items.length + ' items</span>';
                html += '</div>';
                html += '<div class="batch-items">';
                for (const item of batch.items) {
                    html += '<div class="batch-item-entry">';
                    html += '<span class="status-indicator status-pending"></span>';
                    html += '<span>' + item.name + '</span>';
                    html += '</div>';
                }
                html += '</div></div>';
            }
            
            if (plan.warnings && plan.warnings.length > 0) {
                html += '<div style="margin-top: 15px; color: var(--vscode-charts-yellow);">';
                html += '<strong>Warnings:</strong><ul>';
                for (const warning of plan.warnings) {
                    html += '<li>' + warning + '</li>';
                }
                html += '</ul></div>';
            }
            
            container.innerHTML = html;
            log('Plan built: ' + summary.totalBatches + ' batches, ' + summary.totalItems + ' items', 'success');
        }
        
        function validatePlan() {
            if (!currentPlan) {
                log('No plan to validate', 'error');
                return;
            }
            
            // Validate plan structure
            if (!currentPlan.batches || !Array.isArray(currentPlan.batches) || currentPlan.batches.length === 0) {
                log('Invalid plan structure. Please rebuild the plan.', 'error');
                return;
            }
            
            const selectedOrg = document.getElementById('orgSelect').value;
            if (!selectedOrg) {
                log('Please select a target org before validating', 'error');
                return;
            }
            
            log('Starting batch-by-batch validation against: ' + selectedOrg, 'info');
            log('Plan has ' + currentPlan.batches.length + ' batches with ' + (currentPlan.totalItems || 0) + ' total items', 'info');
            
            const validateBtn = document.getElementById('validateBtn');
            validateBtn.disabled = true;
            validateBtn.textContent = 'Validating...';
            
            // Clear any previous error messages
            const planPanel = document.getElementById('deployPlanPanel');
            const existingErrors = planPanel.querySelectorAll('[style*="errorBackground"]');
            existingErrors.forEach(el => el.remove());
            
            try {
                vscode.postMessage({
                    command: 'validatePlan',
                    plan: currentPlan
                });
            } catch (error) {
                log('Error sending validation request: ' + error.message, 'error');
                validateBtn.disabled = false;
                validateBtn.textContent = 'Validate';
            }
        }
        
        function deployPlan() {
            if (!currentPlan) {
                log('No plan to deploy', 'error');
                return;
            }
            
            const selectedOrg = document.getElementById('orgSelect').value;
            if (!selectedOrg) {
                log('Please select a target org before deploying', 'error');
                return;
            }
            
            log('Starting deployment to: ' + selectedOrg, 'info');
            vscode.postMessage({
                command: 'deployPlan',
                plan: currentPlan,
                checkOnly: false
            });
        }
        
        function renderDeployResult(result) {
            if (result.success) {
                log('Deployment completed successfully!', 'success');
                log('Completed ' + result.completedBatches + '/' + result.totalBatches + ' batches in ' + (result.overallDuration / 1000).toFixed(1) + 's', 'success');
            } else {
                log('Deployment failed at batch ' + result.failedAtBatch, 'error');
                for (const batchResult of result.results) {
                    if (!batchResult.success && batchResult.errors) {
                        for (const error of batchResult.errors) {
                            log(error.componentType + '/' + error.componentName + ': ' + error.message, 'error');
                        }
                    }
                }
            }
        }
        
        function renderValidationResult(result) {
            const container = document.getElementById('deployPlanPanel');
            
            // Show retrieved metadata info if any
            if (result.retrievedMetadata && result.retrievedMetadata.length > 0) {
                log('', 'info');
                log('📥 Retrieved ' + result.retrievedMetadata.length + ' missing custom metadata components from org:', 'success');
                for (const retrieved of result.retrievedMetadata) {
                    log('  ✓ ' + retrieved.type + ': ' + retrieved.name, 'success');
                }
                log('These components have been added to your local project.', 'info');
            }
            
            if (result.success) {
                log('✅ Validation PASSED! All ' + result.totalBatches + ' batches validated successfully.', 'success');
                log('Duration: ' + (result.overallDuration / 1000).toFixed(1) + 's', 'info');
                
                // Update batch status indicators to success
                for (let i = 1; i <= result.totalBatches; i++) {
                    updateBatchStatus(i, 'success');
                }
            } else {
                log('❌ Validation FAILED at batch ' + result.failedAtBatch, 'error');
                
                // Update batch status indicators
                for (let i = 1; i <= result.totalBatches; i++) {
                    if (i < result.failedAtBatch) {
                        updateBatchStatus(i, 'success');
                    } else if (i === result.failedAtBatch) {
                        updateBatchStatus(i, 'error');
                    } else {
                        updateBatchStatus(i, 'pending');
                    }
                }
                
                // Show detailed errors
                for (const batchResult of result.results) {
                    if (!batchResult.success && batchResult.errors && batchResult.errors.length > 0) {
                        log('Batch ' + batchResult.batchNumber + ' (' + batchResult.metadataType + ') errors:', 'error');
                        for (const error of batchResult.errors) {
                            log('  • ' + error, 'error');
                        }
                    }
                }
            }
            
            // Show package.xml files and commands for all batches (always show, regardless of success/failure)
            if (result.results && result.results.length > 0) {
                let commandsHtml = '<div style="margin-top: 20px; padding: 15px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 6px;">';
                commandsHtml += '<h3 style="margin-top: 0; margin-bottom: 15px;">📦 Package.xml Files & Validation Commands</h3>';
                
                
                for (const batchResult of result.results) {
                    if (batchResult.packageXmlPath && batchResult.validateCommand) {
                        const statusColor = batchResult.success ? 'var(--vscode-charts-green)' : (batchResult.errors && batchResult.errors.length > 0 ? 'var(--vscode-errorForeground)' : 'var(--vscode-charts-yellow)');
                        const statusIcon = batchResult.success ? '✓' : (batchResult.errors && batchResult.errors.length > 0 ? '✗' : '⏳');
                        
                        commandsHtml += '<div style="margin-bottom: 20px; padding: 12px; background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px;">';
                        commandsHtml += '<div style="font-weight: 600; margin-bottom: 8px;">';
                        commandsHtml += '<span style="color: ' + statusColor + '; margin-right: 8px; font-size: 1.1em;">' + statusIcon + '</span>';
                        commandsHtml += 'Batch ' + batchResult.batchNumber + ': ' + batchResult.metadataType + ' (' + batchResult.componentsValidated + ' components)';
                        commandsHtml += '</div>';
                        commandsHtml += '<div style="margin-bottom: 8px; font-size: 0.9em; color: var(--vscode-descriptionForeground);">';
                        commandsHtml += '<strong>Package.xml:</strong> <code style="background: var(--vscode-textCodeBlock-background); padding: 2px 6px; border-radius: 3px;">' + batchResult.packageXmlPath + '</code>';
                        commandsHtml += '</div>';
                        commandsHtml += '<div style="margin-bottom: 8px;">';
                        commandsHtml += '<strong>Validation Command:</strong>';
                        commandsHtml += '<div style="margin-top: 5px; padding: 10px 50px 10px 10px; background: var(--vscode-terminal-background); border-radius: 4px; font-family: monospace; font-size: 0.9em; word-break: break-all; position: relative;">';
                        commandsHtml += '<span id="cmd' + batchResult.batchNumber + '">' + batchResult.validateCommand + '</span>';
                        commandsHtml += '<button class="btn btn-secondary btn-sm" onclick="copyValidationCommand(' + batchResult.batchNumber + ')" style="position: absolute; right: 10px; top: 50%; transform: translateY(-50%);">Copy</button>';
                        commandsHtml += '</div>';
                        commandsHtml += '</div>';
                        commandsHtml += '</div>';
                    }
                }
                
                commandsHtml += '</div>';
                
                // Append to container
                const existingHtml = container.innerHTML;
                container.innerHTML = existingHtml + commandsHtml;
                
                // Show suggestion for missing metadata
                if (result.missingMetadataFoundLocally && result.missingMetadataFoundLocally.length > 0) {
                    log('', 'info');
                    log('💡 Found missing dependencies that exist in your local project:', 'info');
                    for (const missing of result.missingMetadataFoundLocally) {
                        log('  → ' + missing.type + ': ' + missing.name, 'info');
                    }
                    log('Consider adding these to your selection and rebuilding the plan.', 'info');
                    
                    // Auto-add missing metadata to selection
                    if (confirm('Add missing dependencies to selection and rebuild plan?')) {
                        for (const missing of result.missingMetadataFoundLocally) {
                            const key = missing.type + ':' + missing.name;
                            if (!selectedItems.has(key)) {
                                selectedItems.add(key);
                            }
                        }
                        renderMetadataTree();
                        updateDependenciesPanel();
                        log('Added ' + result.missingMetadataFoundLocally.length + ' missing dependencies. Click "Build Plan" to create a new plan.', 'success');
                    }
                }
                
                if (result.suggestion) {
                    log('', 'info');
                    log('Suggestion: ' + result.suggestion, 'info');
                }
                
                // Handle timeout case
                if (result.timedOut) {
                    log('', 'warning');
                    log('⏱️ Validation timed out due to MCP 60-second limit.', 'warning');
                    log('Completed ' + result.completedBatches + ' batches before timeout.', 'info');
                    if (result.nextBatchToValidate) {
                        log('To continue validation, use the validate_batch tool for remaining batches.', 'info');
                    }
                }
            }
        }
        
        function updateBatchStatus(batchNumber, status) {
            const batchItems = document.querySelectorAll('.batch-item');
            if (batchItems[batchNumber - 1]) {
                const statusIndicator = batchItems[batchNumber - 1].querySelector('.status-indicator');
                if (statusIndicator) {
                    statusIndicator.className = 'status-indicator status-' + status;
                }
            }
        }
        
        function renderCliAnalysis(analysis) {
            const container = document.getElementById('cliAnalysisResult');
            container.style.display = 'block';
            
            let html = '<div style="padding: 15px; background: var(--vscode-editor-inactiveSelectionBackground); border-radius: 6px;">';
            
            // Summary
            html += '<div style="margin-bottom: 15px;">';
            html += '<h3 style="margin-bottom: 10px;">Analysis Summary</h3>';
            html += '<div><strong>Status:</strong> ';
            if (analysis.success) {
                html += '<span style="color: var(--vscode-charts-green);">✓ Success</span>';
            } else {
                html += '<span style="color: var(--vscode-errorForeground);">✗ Failed</span>';
            }
            html += '</div>';
            
            if (analysis.commandType) {
                html += '<div style="margin-top: 5px;"><strong>Command:</strong> ' + analysis.commandType + '</div>';
            }
            
            if (analysis.totalErrors !== undefined) {
                html += '<div style="margin-top: 5px;"><strong>Total Errors:</strong> ' + analysis.totalErrors + '</div>';
            }
            
            if (analysis.totalWarnings !== undefined) {
                html += '<div style="margin-top: 5px;"><strong>Warnings:</strong> ' + analysis.totalWarnings + '</div>';
            }
            
            html += '</div>';
            
            // Errors
            if (analysis.errors && analysis.errors.length > 0) {
                html += '<div style="margin-top: 15px;">';
                html += '<h4 style="margin-bottom: 10px; color: var(--vscode-errorForeground);">Errors</h4>';
                for (const error of analysis.errors) {
                    html += '<div style="padding: 10px; margin-bottom: 8px; background: var(--vscode-inputValidation-errorBackground); border-left: 3px solid var(--vscode-errorForeground); border-radius: 4px;">';
                    html += '<div style="font-weight: 600; margin-bottom: 5px;">' + (error.component || 'Unknown') + '</div>';
                    html += '<div style="font-size: 0.9em;">' + error.message + '</div>';
                    if (error.lineNumber) {
                        html += '<div style="font-size: 0.85em; color: var(--vscode-descriptionForeground); margin-top: 5px;">Line: ' + error.lineNumber + '</div>';
                    }
                    html += '</div>';
                }
                html += '</div>';
            }
            
            // Missing Metadata
            if (analysis.missingMetadata && analysis.missingMetadata.length > 0) {
                html += '<div style="margin-top: 15px;">';
                html += '<h4 style="margin-bottom: 10px;">Missing Metadata</h4>';
                html += '<div style="padding: 10px; background: var(--vscode-inputValidation-warningBackground); border-radius: 4px;">';
                for (const missing of analysis.missingMetadata) {
                    html += '<div style="margin-bottom: 5px;">';
                    html += '<strong>' + missing.type + ':</strong> ' + missing.name;
                    if (missing.objectName) {
                        html += ' (on ' + missing.objectName + ')';
                    }
                    html += '</div>';
                }
                html += '</div>';
                html += '</div>';
            }
            
            // Suggestions
            if (analysis.suggestions && analysis.suggestions.length > 0) {
                html += '<div style="margin-top: 15px;">';
                html += '<h4 style="margin-bottom: 10px;">Suggestions</h4>';
                html += '<ul style="margin-left: 20px;">';
                for (const suggestion of analysis.suggestions) {
                    html += '<li style="margin-bottom: 5px;">' + suggestion + '</li>';
                }
                html += '</ul>';
                html += '</div>';
            }
            
            html += '</div>';
            container.innerHTML = html;
            
            // Also log to main log
            if (analysis.success) {
                log('CLI output analysis: Success', 'success');
            } else {
                log('CLI output analysis: Found ' + (analysis.totalErrors || 0) + ' error(s)', 'error');
            }
        }
        
        function log(message, type = 'info') {
            const logOutput = document.getElementById('logOutput');
            const timestamp = new Date().toLocaleTimeString();
            const className = type === 'error' ? 'log-error' : (type === 'success' ? 'log-success' : '');
            logOutput.innerHTML += '<div class="log-line ' + className + '">[' + timestamp + '] ' + message + '</div>';
            logOutput.scrollTop = logOutput.scrollHeight;
        }
        
        function clearLogs() {
            document.getElementById('logOutput').innerHTML = '<div class="log-line">Logs cleared...</div>';
        }
        
        function clearCliOutput() {
            document.getElementById('cliOutputInput').value = '';
            document.getElementById('cliAnalysisResult').style.display = 'none';
            document.getElementById('cliAnalysisResult').innerHTML = '';
        }
        
        function analyzeCliOutput() {
            const output = document.getElementById('cliOutputInput').value.trim();
            if (!output) {
                log('Please paste CLI output to analyze', 'error');
                return;
            }
            
            log('Analyzing CLI output...', 'info');
            vscode.postMessage({
                command: 'analyzeCliOutput',
                output: output
            });
        }
    </script>
</body>
</html>`;
  }

  public dispose() {
    DeploymentBuddyPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const disposable = this._disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
