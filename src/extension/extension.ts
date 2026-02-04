/**
 * Deployment Buddy VS Code Extension
 * Main entry point for the extension
 */

import * as vscode from 'vscode';
import { McpManager } from './mcp-manager';
import { DeploymentBuddyPanel } from './webview/panel';

let mcpManager: McpManager;

export function activate(context: vscode.ExtensionContext) {
  console.log('Deployment Buddy extension is now active');

  // Initialize MCP Manager
  mcpManager = new McpManager();

  // Register commands
  const startServerCommand = vscode.commands.registerCommand(
    'deploymentBuddy.startServer',
    async () => {
      try {
        await mcpManager.start();
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to start server: ${error.message}`);
      }
    }
  );

  const stopServerCommand = vscode.commands.registerCommand(
    'deploymentBuddy.stopServer',
    async () => {
      try {
        await mcpManager.stop();
      } catch (error: any) {
        vscode.window.showErrorMessage(`Failed to stop server: ${error.message}`);
      }
    }
  );

  const openUICommand = vscode.commands.registerCommand(
    'deploymentBuddy.openUI',
    async () => {
      // Ensure server is running
      if (!mcpManager.isConnected) {
        const choice = await vscode.window.showInformationMessage(
          'MCP Server is not running. Start it now?',
          'Start Server',
          'Cancel'
        );
        
        if (choice === 'Start Server') {
          try {
            await mcpManager.start();
          } catch {
            return;
          }
        } else {
          return;
        }
      }

      // Open the webview panel
      DeploymentBuddyPanel.createOrShow(context.extensionUri, mcpManager);
    }
  );

  const showLogsCommand = vscode.commands.registerCommand(
    'deploymentBuddy.showLogs',
    () => {
      mcpManager.showOutput();
    }
  );

  // Register list bots command (for command palette)
  const listBotsCommand = vscode.commands.registerCommand(
    'deploymentBuddy.listBots',
    async () => {
      if (!mcpManager.isConnected) {
        vscode.window.showWarningMessage('Please start the MCP server first');
        return;
      }

      const result = await mcpManager.callTool('list_bots');
      if (result.success && result.data) {
        const bots = result.data.bots || [];
        if (bots.length === 0) {
          vscode.window.showInformationMessage('No bots found in the project');
          return;
        }

        const items = bots.map((bot: any) => ({
          label: bot.name,
          description: bot.label,
          detail: bot.filePath
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Select a bot to view details'
        });

        if (selected) {
          // Show bot versions
          const versionsResult = await mcpManager.callTool('list_bot_versions', {
            botName: selected.label
          });

          if (versionsResult.success && versionsResult.data) {
            const versions = versionsResult.data.versions || [];
            const versionItems = versions.map((v: any) => ({
              label: v.name,
              description: v.fullName,
              detail: v.filePath
            }));

            if (versionItems.length > 0) {
              vscode.window.showQuickPick(versionItems, {
                placeHolder: `Versions for ${selected.label}`
              });
            } else {
              vscode.window.showInformationMessage(`No versions found for ${selected.label}`);
            }
          }
        }
      } else {
        vscode.window.showErrorMessage(result.error || 'Failed to list bots');
      }
    }
  );

  // Register analyze command
  const analyzeCommand = vscode.commands.registerCommand(
    'deploymentBuddy.analyzeFile',
    async () => {
      if (!mcpManager.isConnected) {
        vscode.window.showWarningMessage('Please start the MCP server first');
        return;
      }

      // Get the current file
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No file is currently open');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const fileName = filePath.split('/').pop() || '';
      
      // Determine type from file name
      let assetType: string | undefined;
      let assetName: string | undefined;

      if (fileName.endsWith('.bot-meta.xml')) {
        assetType = 'Bot';
        assetName = fileName.replace('.bot-meta.xml', '');
      } else if (fileName.endsWith('.botVersion-meta.xml')) {
        assetType = 'BotVersion';
        assetName = fileName.replace('.botVersion-meta.xml', '');
      } else if (fileName.endsWith('.genAiFunction-meta.xml')) {
        assetType = 'GenAiFunction';
        assetName = fileName.replace('.genAiFunction-meta.xml', '');
      } else if (fileName.endsWith('.genAiPlugin-meta.xml')) {
        assetType = 'GenAiPlugin';
        assetName = fileName.replace('.genAiPlugin-meta.xml', '');
      } else if (fileName.endsWith('.genAiPlannerBundle-meta.xml')) {
        assetType = 'GenAiPlannerBundle';
        assetName = fileName.replace('.genAiPlannerBundle-meta.xml', '');
      }

      if (!assetType || !assetName) {
        vscode.window.showWarningMessage('This file type is not supported for analysis');
        return;
      }

      const result = await mcpManager.callTool('analyze_references', {
        assetType,
        assetName
      });

      if (result.success && result.data) {
        const refs = result.data.details || [];
        if (refs.length === 0) {
          vscode.window.showInformationMessage(`No dependencies found for ${assetName}`);
          return;
        }

        // Show dependencies in quick pick
        const items = refs.map((ref: any) => ({
          label: `${ref.targetType}: ${ref.targetName}`,
          description: ref.referenceType,
          detail: `Referenced by ${ref.sourceName}`
        }));

        vscode.window.showQuickPick(items, {
          placeHolder: `Dependencies for ${assetName}`,
          canPickMany: false
        });
      } else {
        vscode.window.showErrorMessage(result.error || 'Failed to analyze file');
      }
    }
  );

  // Add commands to subscriptions
  context.subscriptions.push(
    startServerCommand,
    stopServerCommand,
    openUICommand,
    showLogsCommand,
    listBotsCommand,
    analyzeCommand,
    mcpManager
  );

  // Auto-start server if configured
  const config = vscode.workspace.getConfiguration('deploymentBuddy');
  const autoStart = config.get<boolean>('autoStart', false);
  if (autoStart) {
    mcpManager.start().catch(() => {
      // Ignore auto-start failures
    });
  }
}

export function deactivate() {
  if (mcpManager) {
    mcpManager.dispose();
  }
}
