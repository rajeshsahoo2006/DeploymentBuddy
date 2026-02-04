/**
 * Metadata Parser Service
 * Parses Salesforce metadata XML files for Bots, GenAI assets, etc.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { XMLParser } from 'fast-xml-parser';
import {
  Bot,
  BotVersion,
  GenAiAsset,
  GenAiAssetType,
  Reference,
  MetadataType
} from '../types';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseAttributeValue: true,
  trimValues: true
});

export class MetadataParser {
  private projectPath: string;
  private forceAppPath: string;

  constructor(projectPath: string) {
    this.projectPath = projectPath;
    this.forceAppPath = path.join(projectPath, 'force-app', 'main', 'default');
  }

  /**
   * Get all Bot metadata
   */
  async listBots(): Promise<Bot[]> {
    const botsPath = path.join(this.forceAppPath, 'bots');
    const bots: Bot[] = [];

    try {
      const entries = await fs.readdir(botsPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const botFilePath = path.join(botsPath, entry.name, `${entry.name}.bot-meta.xml`);
          try {
            const content = await fs.readFile(botFilePath, 'utf8');
            const parsed = xmlParser.parse(content);
            const botData = parsed.Bot || {};
            
            bots.push({
              name: entry.name,
              fullName: entry.name,
              label: botData.label || entry.name,
              description: botData.description,
              filePath: botFilePath
            });
          } catch {
            // Bot file might not exist or be invalid
            bots.push({
              name: entry.name,
              fullName: entry.name,
              filePath: botFilePath
            });
          }
        }
      }
    } catch {
      // Bots directory doesn't exist
    }

    return bots;
  }

  /**
   * Get all versions for a specific Bot
   */
  async listBotVersions(botName: string): Promise<BotVersion[]> {
    const botPath = path.join(this.forceAppPath, 'bots', botName);
    const versions: BotVersion[] = [];

    try {
      const entries = await fs.readdir(botPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.botVersion-meta.xml')) {
          const versionName = entry.name.replace('.botVersion-meta.xml', '');
          const versionPath = path.join(botPath, entry.name);
          
          try {
            const content = await fs.readFile(versionPath, 'utf8');
            const parsed = xmlParser.parse(content);
            const versionData = parsed.BotVersion || {};
            
            versions.push({
              name: versionName,
              fullName: `${botName}.${versionName}`,
              botName: botName,
              versionNumber: versionData.versionNumber,
              filePath: versionPath
            });
          } catch {
            versions.push({
              name: versionName,
              fullName: `${botName}.${versionName}`,
              botName: botName,
              filePath: versionPath
            });
          }
        }
      }
    } catch {
      // Bot directory doesn't exist
    }

    return versions;
  }

  /**
   * Get all GenAI assets (Functions, Plugins, Planners)
   * These are stored in subdirectories, e.g.:
   * genAiFunctions/FunctionName/FunctionName.genAiFunction-meta.xml
   */
  async listGenAiAssets(type?: GenAiAssetType): Promise<GenAiAsset[]> {
    const assets: GenAiAsset[] = [];
    const typesToScan: GenAiAssetType[] = type 
      ? [type] 
      : ['GenAiFunction', 'GenAiPlugin', 'GenAiPlannerBundle'];

    for (const assetType of typesToScan) {
      const folderName = this.getGenAiFolderName(assetType);
      const assetPath = path.join(this.forceAppPath, folderName);
      const metaExtension = this.getMetadataExtension(assetType);
      
      try {
        const entries = await fs.readdir(assetPath, { withFileTypes: true });
        
        for (const entry of entries) {
          // GenAI assets are stored in subdirectories
          if (entry.isDirectory()) {
            const assetName = entry.name;
            
            // Try different file naming patterns
            // Pattern 1: Name.extension-meta.xml (GenAiFunction, GenAiPlugin)
            // Pattern 2: Name.extension (GenAiPlannerBundle)
            const possibleFileNames = [
              `${assetName}.${metaExtension}-meta.xml`,
              `${assetName}.${metaExtension}`
            ];
            
            let foundFile = false;
            for (const metaFileName of possibleFileNames) {
              const filePath = path.join(assetPath, assetName, metaFileName);
              
              try {
                const content = await fs.readFile(filePath, 'utf8');
                const parsed = xmlParser.parse(content);
                const assetData = parsed[assetType] || {};
                
                assets.push({
                  name: assetName,
                  fullName: assetName,
                  type: assetType,
                  description: assetData.description || assetData.developerName || assetData.masterLabel,
                  filePath: filePath
                });
                foundFile = true;
                break;
              } catch {
                // Try next pattern
              }
            }
            
            // If no file found but directory exists, still add it
            if (!foundFile) {
              const defaultPath = path.join(assetPath, assetName, `${assetName}.${metaExtension}`);
              assets.push({
                name: assetName,
                fullName: assetName,
                type: assetType,
                filePath: defaultPath
              });
            }
          }
          // Also check for flat files (older format)
          else if (entry.isFile() && entry.name.endsWith('-meta.xml')) {
            const assetName = entry.name.replace(/\.[^.]+$/, '').replace(/-meta$/, '');
            const filePath = path.join(assetPath, entry.name);
            
            try {
              const content = await fs.readFile(filePath, 'utf8');
              const parsed = xmlParser.parse(content);
              const assetData = parsed[assetType] || {};
              
              assets.push({
                name: assetName,
                fullName: assetName,
                type: assetType,
                description: assetData.description || assetData.developerName,
                filePath: filePath
              });
            } catch {
              assets.push({
                name: assetName,
                fullName: assetName,
                type: assetType,
                filePath: filePath
              });
            }
          }
        }
      } catch {
        // Folder doesn't exist
      }
    }

    return assets;
  }

  /**
   * Analyze references in a metadata file
   * Returns Apex classes and Flows that are referenced
   */
  async analyzeReferences(assetType: MetadataType, assetName: string): Promise<Reference[]> {
    const references: Reference[] = [];
    const filePath = await this.getMetadataFilePath(assetType, assetName);
    
    if (!filePath) {
      return references;
    }

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = xmlParser.parse(content);
      
      // Extract references based on asset type
      switch (assetType) {
        case 'GenAiPlannerBundle':
          this.extractPlannerReferences(parsed, assetName, references);
          break;
        case 'GenAiPlugin':
          this.extractPluginReferences(parsed, assetName, references);
          break;
        case 'GenAiFunction':
          this.extractFunctionReferences(parsed, assetName, references);
          break;
        case 'Bot':
        case 'BotVersion':
          this.extractBotReferences(parsed, assetType, assetName, references);
          break;
      }

      // Also scan for Apex class references in the raw content
      this.extractApexReferencesFromContent(content, assetType, assetName, references);
      
      // Scan for Flow references
      this.extractFlowReferencesFromContent(content, assetType, assetName, references);
      
    } catch (e) {
      // File not found or parse error
    }

    // Deduplicate references
    return this.deduplicateReferences(references);
  }

  /**
   * Deep analyze all dependencies for a component recursively
   * Returns all dependent components including Apex classes and Flows
   */
  async analyzeAllDependencies(assetType: MetadataType, assetName: string): Promise<{
    dependencies: Reference[];
    apexClasses: string[];
    flows: string[];
    genAiFunctions: string[];
    genAiPlugins: string[];
    genAiPlannerBundles: string[];
    summary: string;
  }> {
    const visited = new Set<string>();
    const allDependencies: Reference[] = [];
    const apexClasses = new Set<string>();
    const flows = new Set<string>();
    const genAiFunctions = new Set<string>();
    const genAiPlugins = new Set<string>();
    const genAiPlannerBundles = new Set<string>();

    // Recursive function to analyze dependencies
    const analyzeRecursively = async (type: MetadataType, name: string) => {
      const key = `${type}:${name}`;
      if (visited.has(key)) return;
      visited.add(key);

      // Special handling for Bot - need to scan BotVersion files in same directory
      if (type === 'Bot') {
        await this.analyzeBotAndVersions(name, visited, allDependencies, apexClasses, flows, genAiFunctions, genAiPlugins, genAiPlannerBundles, analyzeRecursively);
        return;
      }

      // Get the file path and read the content
      let filePath = await this.getMetadataFilePath(type, name);
      
      // For GenAi assets, also try the subdirectory structure
      if (!filePath && (type === 'GenAiFunction' || type === 'GenAiPlugin' || type === 'GenAiPlannerBundle')) {
        filePath = await this.findGenAiFilePath(type, name);
      }
      
      if (!filePath) {
        // Try to find the file by scanning directories
        await this.findAndAnalyzeByName(type, name, visited, allDependencies, apexClasses, flows, genAiFunctions, genAiPlugins, genAiPlannerBundles, analyzeRecursively);
        return;
      }

      try {
        const content = await fs.readFile(filePath, 'utf8');
        
        // Deep scan for all types of references
        const refs = await this.deepScanReferences(content, type, name);
        
        for (const ref of refs) {
          allDependencies.push(ref);
          
          // Categorize the reference and recursively analyze
          switch (ref.targetType) {
            case 'ApexClass':
              apexClasses.add(ref.targetName);
              // Don't recursively analyze Apex - it's a leaf node
              break;
            case 'Flow':
              flows.add(ref.targetName);
              // Recursively analyze Flow to find Apex dependencies
              await analyzeRecursively('Flow', ref.targetName);
              break;
            case 'GenAiFunction':
              genAiFunctions.add(ref.targetName);
              await analyzeRecursively('GenAiFunction', ref.targetName);
              break;
            case 'GenAiPlugin':
              genAiPlugins.add(ref.targetName);
              await analyzeRecursively('GenAiPlugin', ref.targetName);
              break;
            case 'GenAiPlannerBundle':
              genAiPlannerBundles.add(ref.targetName);
              await analyzeRecursively('GenAiPlannerBundle', ref.targetName);
              break;
          }
        }
      } catch (e) {
        // File not found or parse error - continue
        console.error(`Error analyzing ${type}:${name}:`, e);
      }
    };

    // Start the recursive analysis
    await analyzeRecursively(assetType, assetName);

    // Also scan the GenAi directory structure directly for related files
    await this.scanGenAiDirectoriesForReferences(assetName, apexClasses, flows, genAiFunctions, genAiPlugins, genAiPlannerBundles);

    const summary = `Found ${apexClasses.size} Apex classes, ${flows.size} Flows, ${genAiFunctions.size} GenAI Functions, ${genAiPlugins.size} GenAI Plugins, ${genAiPlannerBundles.size} GenAI Planners`;

    return {
      dependencies: this.deduplicateReferences(allDependencies),
      apexClasses: Array.from(apexClasses),
      flows: Array.from(flows),
      genAiFunctions: Array.from(genAiFunctions),
      genAiPlugins: Array.from(genAiPlugins),
      genAiPlannerBundles: Array.from(genAiPlannerBundles),
      summary
    };
  }

  /**
   * Analyze a Bot and all its BotVersion files
   */
  private async analyzeBotAndVersions(
    botName: string,
    visited: Set<string>,
    allDependencies: Reference[],
    apexClasses: Set<string>,
    flows: Set<string>,
    genAiFunctions: Set<string>,
    genAiPlugins: Set<string>,
    genAiPlannerBundles: Set<string>,
    analyzeRecursively: (type: MetadataType, name: string) => Promise<void>
  ): Promise<void> {
    const botDir = path.join(this.forceAppPath, 'bots', botName);
    
    try {
      const files = await fs.readdir(botDir);
      
      for (const file of files) {
        const filePath = path.join(botDir, file);
        
        // Process both bot-meta.xml and botVersion-meta.xml files
        if (file.endsWith('.bot-meta.xml') || file.endsWith('.botVersion-meta.xml')) {
          try {
            const content = await fs.readFile(filePath, 'utf8');
            const sourceType: MetadataType = file.endsWith('.botVersion-meta.xml') ? 'BotVersion' : 'Bot';
            const sourceName = file.replace('.bot-meta.xml', '').replace('.botVersion-meta.xml', '');
            
            // Deep scan for references
            const refs = await this.deepScanReferences(content, sourceType, sourceName);
            
            for (const ref of refs) {
              allDependencies.push(ref);
              
              switch (ref.targetType) {
                case 'GenAiPlannerBundle':
                  genAiPlannerBundles.add(ref.targetName);
                  await analyzeRecursively('GenAiPlannerBundle', ref.targetName);
                  break;
                case 'GenAiFunction':
                  genAiFunctions.add(ref.targetName);
                  await analyzeRecursively('GenAiFunction', ref.targetName);
                  break;
                case 'GenAiPlugin':
                  genAiPlugins.add(ref.targetName);
                  await analyzeRecursively('GenAiPlugin', ref.targetName);
                  break;
                case 'Flow':
                  flows.add(ref.targetName);
                  await analyzeRecursively('Flow', ref.targetName);
                  break;
                case 'ApexClass':
                  apexClasses.add(ref.targetName);
                  break;
              }
            }
          } catch (e) {
            // Skip unreadable files
          }
        }
      }
    } catch (e) {
      // Bot directory doesn't exist
    }
  }

  /**
   * Find GenAi file path by searching the appropriate directory
   */
  private async findGenAiFilePath(type: MetadataType, name: string): Promise<string | null> {
    const typeToFolder: Record<string, string> = {
      'GenAiFunction': 'genAiFunctions',
      'GenAiPlugin': 'genAiPlugins',
      'GenAiPlannerBundle': 'genAiPlannerBundles'
    };

    const folder = typeToFolder[type];
    if (!folder) return null;

    const basePath = path.join(this.forceAppPath, folder);
    
    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true });
      
      // Search for a directory that matches the name (case-insensitive)
      for (const entry of entries) {
        if (entry.isDirectory()) {
          // Check if directory name matches (case-insensitive or partial match)
          if (entry.name.toLowerCase() === name.toLowerCase() || 
              entry.name.toLowerCase().includes(name.toLowerCase()) ||
              name.toLowerCase().includes(entry.name.toLowerCase())) {
            const dirPath = path.join(basePath, entry.name);
            const files = await fs.readdir(dirPath);
            
            // Find the metadata file
            for (const file of files) {
              if (file.endsWith('-meta.xml') || file.endsWith('.genAiPlannerBundle')) {
                return path.join(dirPath, file);
              }
            }
          }
        }
      }
      
      // Also try flat file structure
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase().includes(name.toLowerCase())) {
          return path.join(basePath, entry.name);
        }
      }
    } catch {
      // Directory doesn't exist
    }

    return null;
  }

  /**
   * Deep scan content for all types of references
   * This parses the actual Salesforce metadata XML structure
   */
  private async deepScanReferences(content: string, sourceType: MetadataType, sourceName: string): Promise<Reference[]> {
    const refs: Reference[] = [];
    
    // Parse XML
    const parsed = xmlParser.parse(content);
    
    // Extract from parsed XML structure based on the actual Salesforce metadata schema
    this.extractFromParsedXml(parsed, sourceType, sourceName, refs);
    
    // Also use regex patterns to catch any missed references
    this.extractReferencesWithRegex(content, sourceType, sourceName, refs);

    return refs;
  }

  /**
   * Extract references using regex patterns for edge cases
   */
  private extractReferencesWithRegex(content: string, sourceType: MetadataType, sourceName: string, refs: Reference[]): void {
    // Pattern for invocationTarget with type
    // <invocationTarget>Flow_Name</invocationTarget>
    // <invocationTargetType>flow</invocationTargetType>
    const invocationPattern = /<invocationTarget>([^<]+)<\/invocationTarget>[\s\S]*?<invocationTargetType>([^<]+)<\/invocationTargetType>/gi;
    let match;
    while ((match = invocationPattern.exec(content)) !== null) {
      const targetName = match[1].trim();
      const targetType = match[2].trim().toLowerCase();
      
      if (targetName && targetType === 'flow') {
        refs.push({ sourceType, sourceName, targetType: 'Flow', targetName, referenceType: 'direct' });
      } else if (targetName && targetType === 'apex') {
        refs.push({ sourceType, sourceName, targetType: 'ApexClass', targetName, referenceType: 'direct' });
      }
    }
    
    // Pattern for actionCalls in Flows
    // <actionName>ApexClassName</actionName>
    // <actionType>apex</actionType>
    const actionPattern = /<actionName>([^<]+)<\/actionName>[\s\S]*?<actionType>([^<]+)<\/actionType>/gi;
    while ((match = actionPattern.exec(content)) !== null) {
      const actionName = match[1].trim();
      const actionType = match[2].trim().toLowerCase();
      
      if (actionName && actionType === 'apex') {
        refs.push({ sourceType, sourceName, targetType: 'ApexClass', targetName: actionName, referenceType: 'direct' });
      } else if (actionName && actionType === 'flow') {
        refs.push({ sourceType, sourceName, targetType: 'Flow', targetName: actionName, referenceType: 'direct' });
      }
    }
    
    // Pattern for genAiPlannerName in BotVersion (conversationDefinitionPlanners)
    const plannerNamePattern = /<genAiPlannerName>([^<]+)<\/genAiPlannerName>/gi;
    while ((match = plannerNamePattern.exec(content)) !== null) {
      const name = match[1].trim();
      if (name) {
        refs.push({ sourceType, sourceName, targetType: 'GenAiPlannerBundle', targetName: name, referenceType: 'direct' });
      }
    }
    
    // Pattern for genAiPluginName in PlannerBundle
    const pluginNamePattern = /<genAiPluginName>([^<]+)<\/genAiPluginName>/gi;
    while ((match = pluginNamePattern.exec(content)) !== null) {
      const name = match[1].trim();
      if (name) {
        refs.push({ sourceType, sourceName, targetType: 'GenAiPlugin', targetName: name, referenceType: 'direct' });
      }
    }
    
    // Pattern for genAiFunctionName in PlannerBundle
    const functionNamePattern = /<genAiFunctionName>([^<]+)<\/genAiFunctionName>/gi;
    while ((match = functionNamePattern.exec(content)) !== null) {
      const name = match[1].trim();
      if (name) {
        refs.push({ sourceType, sourceName, targetType: 'GenAiFunction', targetName: name, referenceType: 'direct' });
      }
    }
    
    // Pattern for functionName in localActionLinks
    const localActionFunctionPattern = /<functionName>([^<]+)<\/functionName>/gi;
    while ((match = localActionFunctionPattern.exec(content)) !== null) {
      const name = match[1].trim();
      if (name) {
        refs.push({ sourceType, sourceName, targetType: 'GenAiFunction', targetName: name, referenceType: 'direct' });
      }
    }
    
    // Pattern for source references (often points to original GenAiFunction)
    const sourcePattern = /<source>([^<]+)<\/source>/gi;
    while ((match = sourcePattern.exec(content)) !== null) {
      const name = match[1].trim();
      // Filter out non-component names (like template references)
      if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !name.includes('__')) {
        refs.push({ sourceType, sourceName, targetType: 'GenAiFunction', targetName: name, referenceType: 'inferred' });
      }
    }
  }

  /**
   * Extract references from parsed XML structure
   * Based on actual Salesforce metadata XML schema
   */
  private extractFromParsedXml(parsed: any, sourceType: MetadataType, sourceName: string, refs: Reference[]): void {
    // Handle GenAiFunction structure
    // Key fields: invocationTarget, invocationTargetType
    if (parsed.GenAiFunction) {
      const func = parsed.GenAiFunction;
      
      // invocationTarget + invocationTargetType
      if (func.invocationTarget && func.invocationTargetType) {
        const targetType = func.invocationTargetType.toLowerCase();
        if (targetType === 'flow') {
          refs.push({ sourceType, sourceName, targetType: 'Flow', targetName: func.invocationTarget, referenceType: 'direct' });
        } else if (targetType === 'apex') {
          refs.push({ sourceType, sourceName, targetType: 'ApexClass', targetName: func.invocationTarget, referenceType: 'direct' });
        }
      }
    }

    // Handle Flow structure
    // Key fields: actionCalls with actionName + actionType
    if (parsed.Flow) {
      const flow = parsed.Flow;
      
      // Process actionCalls
      if (flow.actionCalls) {
        const actionCalls = Array.isArray(flow.actionCalls) ? flow.actionCalls : [flow.actionCalls];
        for (const action of actionCalls) {
          if (action.actionName && action.actionType) {
            const actionType = action.actionType.toLowerCase();
            if (actionType === 'apex') {
              refs.push({ sourceType, sourceName, targetType: 'ApexClass', targetName: action.actionName, referenceType: 'direct' });
            } else if (actionType === 'flow') {
              refs.push({ sourceType, sourceName, targetType: 'Flow', targetName: action.actionName, referenceType: 'direct' });
            }
          }
        }
      }
      
      // Process subflows
      if (flow.subflows) {
        const subflows = Array.isArray(flow.subflows) ? flow.subflows : [flow.subflows];
        for (const subflow of subflows) {
          if (subflow.flowName) {
            refs.push({ sourceType, sourceName, targetType: 'Flow', targetName: subflow.flowName, referenceType: 'direct' });
          }
        }
      }
    }

    // Handle GenAiPlannerBundle structure
    // Key fields: localTopicLinks, localActionLinks, localTopics, plannerActions
    if (parsed.GenAiPlannerBundle) {
      const bundle = parsed.GenAiPlannerBundle;
      
      // localTopicLinks -> genAiPluginName
      if (bundle.localTopicLinks) {
        const links = Array.isArray(bundle.localTopicLinks) ? bundle.localTopicLinks : [bundle.localTopicLinks];
        for (const link of links) {
          if (link.genAiPluginName) {
            refs.push({ sourceType, sourceName, targetType: 'GenAiPlugin', targetName: link.genAiPluginName, referenceType: 'direct' });
          }
        }
      }
      
      // localActionLinks -> genAiFunctionName
      if (bundle.localActionLinks) {
        const links = Array.isArray(bundle.localActionLinks) ? bundle.localActionLinks : [bundle.localActionLinks];
        for (const link of links) {
          if (link.genAiFunctionName) {
            refs.push({ sourceType, sourceName, targetType: 'GenAiFunction', targetName: link.genAiFunctionName, referenceType: 'direct' });
          }
        }
      }
      
      // localTopics contain embedded plugins with actions
      if (bundle.localTopics) {
        const topics = Array.isArray(bundle.localTopics) ? bundle.localTopics : [bundle.localTopics];
        for (const topic of topics) {
          // localActionLinks within topic -> functionName
          if (topic.localActionLinks) {
            const actionLinks = Array.isArray(topic.localActionLinks) ? topic.localActionLinks : [topic.localActionLinks];
            for (const link of actionLinks) {
              if (link.functionName) {
                refs.push({ sourceType, sourceName, targetType: 'GenAiFunction', targetName: link.functionName, referenceType: 'direct' });
              }
            }
          }
          
          // localActions contain invocationTarget + invocationTargetType
          if (topic.localActions) {
            const actions = Array.isArray(topic.localActions) ? topic.localActions : [topic.localActions];
            for (const action of actions) {
              if (action.invocationTarget && action.invocationTargetType) {
                const targetType = action.invocationTargetType.toLowerCase();
                if (targetType === 'flow') {
                  refs.push({ sourceType, sourceName, targetType: 'Flow', targetName: action.invocationTarget, referenceType: 'direct' });
                } else if (targetType === 'apex') {
                  refs.push({ sourceType, sourceName, targetType: 'ApexClass', targetName: action.invocationTarget, referenceType: 'direct' });
                }
              }
              // Also track the source as GenAiFunction reference
              if (action.source && /^[A-Za-z_][A-Za-z0-9_]*$/.test(action.source)) {
                refs.push({ sourceType, sourceName, targetType: 'GenAiFunction', targetName: action.source, referenceType: 'inferred' });
              }
            }
          }
        }
      }
      
      // plannerActions contain invocationTarget + invocationTargetType
      if (bundle.plannerActions) {
        const actions = Array.isArray(bundle.plannerActions) ? bundle.plannerActions : [bundle.plannerActions];
        for (const action of actions) {
          if (action.invocationTarget && action.invocationTargetType) {
            const targetType = action.invocationTargetType.toLowerCase();
            if (targetType === 'flow') {
              refs.push({ sourceType, sourceName, targetType: 'Flow', targetName: action.invocationTarget, referenceType: 'direct' });
            } else if (targetType === 'apex') {
              refs.push({ sourceType, sourceName, targetType: 'ApexClass', targetName: action.invocationTarget, referenceType: 'direct' });
            }
          }
        }
      }
    }

    // Handle Bot structure
    if (parsed.Bot) {
      const bot = parsed.Bot;
      if (bot.botVersions) {
        const versions = Array.isArray(bot.botVersions) ? bot.botVersions : [bot.botVersions];
        for (const v of versions) {
          if (v.fullName) {
            refs.push({ sourceType, sourceName, targetType: 'BotVersion', targetName: v.fullName, referenceType: 'direct' });
          }
        }
      }
    }

    // Handle BotVersion structure
    if (parsed.BotVersion) {
      const bv = parsed.BotVersion;
      if (bv.conversationDefinitionPlanners) {
        const planners = Array.isArray(bv.conversationDefinitionPlanners) ? bv.conversationDefinitionPlanners : [bv.conversationDefinitionPlanners];
        for (const p of planners) {
          // Check both genAiPlannerName and genAiPlannerBundle (different schema versions)
          const plannerName = p.genAiPlannerName || p.genAiPlannerBundle;
          if (plannerName) {
            refs.push({ sourceType, sourceName, targetType: 'GenAiPlannerBundle', targetName: plannerName, referenceType: 'direct' });
          }
        }
      }
    }

    // Handle GenAiPlugin structure
    if (parsed.GenAiPlugin) {
      const plugin = parsed.GenAiPlugin;
      if (plugin.genAiFunctions) {
        const functions = Array.isArray(plugin.genAiFunctions) ? plugin.genAiFunctions : [plugin.genAiFunctions];
        for (const func of functions) {
          const name = typeof func === 'string' ? func : (func.genAiFunction || func.name || func.functionName);
          if (name) {
            refs.push({ sourceType, sourceName, targetType: 'GenAiFunction', targetName: name, referenceType: 'direct' });
          }
        }
      }
    }
  }

  /**
   * Scan GenAI directories for references when we can't find a file by path
   */
  private async findAndAnalyzeByName(
    type: MetadataType,
    name: string,
    visited: Set<string>,
    allDependencies: Reference[],
    apexClasses: Set<string>,
    flows: Set<string>,
    genAiFunctions: Set<string>,
    genAiPlugins: Set<string>,
    genAiPlannerBundles: Set<string>,
    analyzeRecursively: (type: MetadataType, name: string) => Promise<void>
  ): Promise<void> {
    // Try to find the file by scanning the appropriate directory
    const typeToFolder: Record<string, string> = {
      'GenAiFunction': 'genAiFunctions',
      'GenAiPlugin': 'genAiPlugins',
      'GenAiPlannerBundle': 'genAiPlannerBundles'
    };

    const folder = typeToFolder[type];
    if (!folder) return;

    const basePath = path.join(this.forceAppPath, folder);
    
    try {
      const entries = await fs.readdir(basePath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.toLowerCase() === name.toLowerCase()) {
          // Found a matching directory
          const dirPath = path.join(basePath, entry.name);
          const files = await fs.readdir(dirPath);
          for (const file of files) {
            if (file.endsWith('-meta.xml') || file.endsWith('.genAiPlannerBundle')) {
              const filePath = path.join(dirPath, file);
              const content = await fs.readFile(filePath, 'utf8');
              const refs = await this.deepScanReferences(content, type, name);
              
              for (const ref of refs) {
                allDependencies.push(ref);
                switch (ref.targetType) {
                  case 'ApexClass': apexClasses.add(ref.targetName); break;
                  case 'Flow': flows.add(ref.targetName); break;
                  case 'GenAiFunction': 
                    genAiFunctions.add(ref.targetName);
                    await analyzeRecursively('GenAiFunction', ref.targetName);
                    break;
                  case 'GenAiPlugin':
                    genAiPlugins.add(ref.targetName);
                    await analyzeRecursively('GenAiPlugin', ref.targetName);
                    break;
                  case 'GenAiPlannerBundle':
                    genAiPlannerBundles.add(ref.targetName);
                    await analyzeRecursively('GenAiPlannerBundle', ref.targetName);
                    break;
                }
              }
              break;
            }
          }
        }
      }
    } catch {
      // Directory doesn't exist
    }
  }

  /**
   * Scan GenAi directories for related references
   */
  private async scanGenAiDirectoriesForReferences(
    assetName: string,
    apexClasses: Set<string>,
    flows: Set<string>,
    genAiFunctions: Set<string>,
    genAiPlugins: Set<string>,
    genAiPlannerBundles: Set<string>
  ): Promise<void> {
    // Scan all GenAI directories for files that might reference the asset
    const directories = ['genAiFunctions', 'genAiPlugins', 'genAiPlannerBundles'];
    
    for (const dir of directories) {
      const dirPath = path.join(this.forceAppPath, dir);
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subDirPath = path.join(dirPath, entry.name);
            const files = await fs.readdir(subDirPath);
            for (const file of files) {
              if (file.endsWith('-meta.xml') || file.endsWith('.genAiPlannerBundle')) {
                const filePath = path.join(subDirPath, file);
                try {
                  const content = await fs.readFile(filePath, 'utf8');
                  // Check if this file references our asset
                  if (content.includes(assetName)) {
                    // This file is related, extract its dependencies
                    const type = dir === 'genAiFunctions' ? 'GenAiFunction' : 
                                 dir === 'genAiPlugins' ? 'GenAiPlugin' : 'GenAiPlannerBundle';
                    
                    if (type === 'GenAiFunction') genAiFunctions.add(entry.name);
                    else if (type === 'GenAiPlugin') genAiPlugins.add(entry.name);
                    else genAiPlannerBundles.add(entry.name);
                    
                    // Also extract any Apex/Flow references from this file
                    const refs = await this.deepScanReferences(content, type as MetadataType, entry.name);
                    for (const ref of refs) {
                      if (ref.targetType === 'ApexClass') apexClasses.add(ref.targetName);
                      else if (ref.targetType === 'Flow') flows.add(ref.targetName);
                    }
                  }
                } catch {
                  // Skip unreadable files
                }
              }
            }
          }
        }
      } catch {
        // Directory doesn't exist
      }
    }
  }

  /**
   * Get file path for a metadata component
   */
  private async getMetadataFilePath(type: MetadataType, name: string): Promise<string | null> {
    const typeToFolder: Record<string, string> = {
      'ApexClass': 'classes',
      'Flow': 'flows',
      'GenAiFunction': 'genAiFunctions',
      'GenAiPlugin': 'genAiPlugins',
      'GenAiPlannerBundle': 'genAiPlannerBundles',
      'Bot': 'bots',
      'BotVersion': 'bots'
    };

    const folder = typeToFolder[type];
    if (!folder) return null;

    // List of possible file paths to try
    const possiblePaths: string[] = [];
    
    if (type === 'Bot') {
      possiblePaths.push(path.join(this.forceAppPath, folder, name, `${name}.bot-meta.xml`));
    } else if (type === 'BotVersion') {
      // BotVersion name format: BotName.VersionName
      const [botName, versionName] = name.split('.');
      possiblePaths.push(path.join(this.forceAppPath, folder, botName, `${versionName}.botVersion-meta.xml`));
    } else if (type === 'ApexClass') {
      possiblePaths.push(path.join(this.forceAppPath, folder, `${name}.cls-meta.xml`));
      possiblePaths.push(path.join(this.forceAppPath, folder, `${name}.cls`));
    } else if (type === 'Flow') {
      possiblePaths.push(path.join(this.forceAppPath, folder, `${name}.flow-meta.xml`));
    } else if (type === 'GenAiFunction' || type === 'GenAiPlugin' || type === 'GenAiPlannerBundle') {
      // GenAi assets are stored in subdirectories
      const ext = this.getMetadataExtension(type);
      // Try subdirectory structure first (more common)
      possiblePaths.push(path.join(this.forceAppPath, folder, name, `${name}.${ext}-meta.xml`));
      possiblePaths.push(path.join(this.forceAppPath, folder, name, `${name}.${ext}`));
      // Also try flat structure
      possiblePaths.push(path.join(this.forceAppPath, folder, `${name}.${ext}-meta.xml`));
    } else {
      // Default pattern
      possiblePaths.push(path.join(this.forceAppPath, folder, `${name}.${this.getMetadataExtension(type)}-meta.xml`));
    }

    // Try each possible path
    for (const filePath of possiblePaths) {
      try {
        await fs.access(filePath);
        return filePath;
      } catch {
        // Try next path
      }
    }

    return null;
  }

  private getGenAiFolderName(type: GenAiAssetType): string {
    const map: Record<GenAiAssetType, string> = {
      'GenAiFunction': 'genAiFunctions',
      'GenAiPlugin': 'genAiPlugins',
      'GenAiPlannerBundle': 'genAiPlannerBundles'
    };
    return map[type];
  }

  private getMetadataExtension(type: MetadataType): string {
    const map: Record<string, string> = {
      'GenAiFunction': 'genAiFunction',
      'GenAiPlugin': 'genAiPlugin',
      'GenAiPlannerBundle': 'genAiPlannerBundle',
      'Bot': 'bot',
      'BotVersion': 'botVersion',
      'ApexClass': 'cls',
      'Flow': 'flow'
    };
    return map[type] || type.toLowerCase();
  }

  private extractPlannerReferences(parsed: any, sourceName: string, refs: Reference[]): void {
    const planner = parsed.GenAiPlannerBundle;
    if (!planner) return;

    // Check for plugin references
    if (planner.genAiPlugins) {
      const plugins = Array.isArray(planner.genAiPlugins) 
        ? planner.genAiPlugins 
        : [planner.genAiPlugins];
      
      for (const plugin of plugins) {
        const pluginName = typeof plugin === 'string' ? plugin : plugin.genAiPlugin || plugin.name;
        if (pluginName) {
          refs.push({
            sourceType: 'GenAiPlannerBundle',
            sourceName,
            targetType: 'GenAiPlugin',
            targetName: pluginName,
            referenceType: 'direct'
          });
        }
      }
    }
  }

  private extractPluginReferences(parsed: any, sourceName: string, refs: Reference[]): void {
    const plugin = parsed.GenAiPlugin;
    if (!plugin) return;

    // Check for function references
    if (plugin.genAiFunctions) {
      const functions = Array.isArray(plugin.genAiFunctions) 
        ? plugin.genAiFunctions 
        : [plugin.genAiFunctions];
      
      for (const func of functions) {
        const funcName = typeof func === 'string' ? func : func.genAiFunction || func.name;
        if (funcName) {
          refs.push({
            sourceType: 'GenAiPlugin',
            sourceName,
            targetType: 'GenAiFunction',
            targetName: funcName,
            referenceType: 'direct'
          });
        }
      }
    }
  }

  private extractFunctionReferences(parsed: any, sourceName: string, refs: Reference[]): void {
    const func = parsed.GenAiFunction;
    if (!func) return;

    // Check for Apex class reference
    if (func.apexClass) {
      refs.push({
        sourceType: 'GenAiFunction',
        sourceName,
        targetType: 'ApexClass',
        targetName: func.apexClass,
        referenceType: 'direct'
      });
    }

    // Check for invocable action (could be Apex or Flow)
    if (func.invocableActionName) {
      // Try to determine if it's Apex or Flow
      refs.push({
        sourceType: 'GenAiFunction',
        sourceName,
        targetType: 'ApexClass', // Default to Apex, could be refined
        targetName: func.invocableActionName,
        referenceType: 'inferred'
      });
    }
  }

  private extractBotReferences(parsed: any, sourceType: MetadataType, sourceName: string, refs: Reference[]): void {
    const bot = parsed.Bot || parsed.BotVersion;
    if (!bot) return;

    // Check for planner reference
    if (bot.genAiPlanner) {
      refs.push({
        sourceType,
        sourceName,
        targetType: 'GenAiPlannerBundle',
        targetName: bot.genAiPlannerBundle,
        referenceType: 'direct'
      });
    }
  }

  private extractApexReferencesFromContent(content: string, sourceType: MetadataType, sourceName: string, refs: Reference[]): void {
    // Look for Apex class references in various patterns
    const patterns = [
      /<apexClass>([^<]+)<\/apexClass>/gi,
      /<className>([^<]+)<\/className>/gi,
      /apex:\/\/([A-Za-z_][A-Za-z0-9_]*)/gi,
      /<invocableActionName>([^<]+)<\/invocableActionName>/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const className = match[1].trim();
        if (className && !className.includes('.') && !className.includes('/')) {
          refs.push({
            sourceType,
            sourceName,
            targetType: 'ApexClass',
            targetName: className,
            referenceType: 'inferred'
          });
        }
      }
    }
  }

  private extractFlowReferencesFromContent(content: string, sourceType: MetadataType, sourceName: string, refs: Reference[]): void {
    // Look for Flow references
    const patterns = [
      /<flow>([^<]+)<\/flow>/gi,
      /<flowName>([^<]+)<\/flowName>/gi,
      /flow:\/\/([A-Za-z_][A-Za-z0-9_]*)/gi
    ];

    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        const flowName = match[1].trim();
        if (flowName) {
          refs.push({
            sourceType,
            sourceName,
            targetType: 'Flow',
            targetName: flowName,
            referenceType: 'inferred'
          });
        }
      }
    }
  }

  private deduplicateReferences(refs: Reference[]): Reference[] {
    const seen = new Set<string>();
    return refs.filter(ref => {
      const key = `${ref.sourceType}:${ref.sourceName}:${ref.targetType}:${ref.targetName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  /**
   * Get all Apex classes
   */
  async listApexClasses(): Promise<string[]> {
    const classesPath = path.join(this.forceAppPath, 'classes');
    const classes: string[] = [];

    try {
      const entries = await fs.readdir(classesPath);
      for (const entry of entries) {
        if (entry.endsWith('.cls')) {
          classes.push(entry.replace('.cls', ''));
        }
      }
    } catch {
      // Classes directory doesn't exist
    }

    return classes;
  }

  /**
   * Get detailed info for all Apex classes
   */
  async getApexClassDetails(): Promise<Array<{
    name: string;
    fullName: string;
    filePath: string;
    apiVersion?: string;
    status?: string;
  }>> {
    const classesPath = path.join(this.forceAppPath, 'classes');
    const classes: Array<{
      name: string;
      fullName: string;
      filePath: string;
      apiVersion?: string;
      status?: string;
    }> = [];

    try {
      const entries = await fs.readdir(classesPath);
      for (const entry of entries) {
        if (entry.endsWith('.cls')) {
          const className = entry.replace('.cls', '');
          const clsFilePath = path.join(classesPath, entry);
          const metaFilePath = path.join(classesPath, `${className}.cls-meta.xml`);
          
          let apiVersion: string | undefined;
          let status: string | undefined;
          
          try {
            const metaContent = await fs.readFile(metaFilePath, 'utf8');
            const parsed = xmlParser.parse(metaContent);
            const apexClass = parsed.ApexClass || {};
            apiVersion = apexClass.apiVersion;
            status = apexClass.status;
          } catch {
            // Meta file might not exist
          }
          
          classes.push({
            name: className,
            fullName: className,
            filePath: clsFilePath,
            apiVersion,
            status
          });
        }
      }
    } catch {
      // Classes directory doesn't exist
    }

    return classes;
  }

  /**
   * Get all Flows
   */
  async listFlows(): Promise<string[]> {
    const flowsPath = path.join(this.forceAppPath, 'flows');
    const flows: string[] = [];

    try {
      const entries = await fs.readdir(flowsPath);
      for (const entry of entries) {
        if (entry.endsWith('.flow-meta.xml')) {
          flows.push(entry.replace('.flow-meta.xml', ''));
        }
      }
    } catch {
      // Flows directory doesn't exist
    }

    return flows;
  }

  /**
   * Get detailed info for all Flows
   */
  async getFlowDetails(): Promise<Array<{
    name: string;
    fullName: string;
    filePath: string;
    label?: string;
    processType?: string;
    status?: string;
    description?: string;
  }>> {
    const flowsPath = path.join(this.forceAppPath, 'flows');
    const flows: Array<{
      name: string;
      fullName: string;
      filePath: string;
      label?: string;
      processType?: string;
      status?: string;
      description?: string;
    }> = [];

    try {
      const entries = await fs.readdir(flowsPath);
      for (const entry of entries) {
        if (entry.endsWith('.flow-meta.xml')) {
          const flowName = entry.replace('.flow-meta.xml', '');
          const flowFilePath = path.join(flowsPath, entry);
          
          let label: string | undefined;
          let processType: string | undefined;
          let status: string | undefined;
          let description: string | undefined;
          
          try {
            const content = await fs.readFile(flowFilePath, 'utf8');
            const parsed = xmlParser.parse(content);
            const flow = parsed.Flow || {};
            label = flow.label;
            processType = flow.processType;
            status = flow.status;
            description = flow.description;
          } catch {
            // Could not parse flow
          }
          
          flows.push({
            name: flowName,
            fullName: flowName,
            filePath: flowFilePath,
            label,
            processType,
            status,
            description
          });
        }
      }
    } catch {
      // Flows directory doesn't exist
    }

    return flows;
  }
}
