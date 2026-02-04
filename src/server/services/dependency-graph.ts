/**
 * Dependency Graph Service
 * Builds deployment order based on dependencies and type-layer constraints
 */

import {
  Reference,
  MetadataType,
  DeployBatch,
  DeployItem,
  DeployPlan,
  DEPLOYMENT_LAYER_ORDER
} from '../types';
import { MetadataParser } from './metadata-parser';

export class DependencyGraph {
  private parser: MetadataParser;
  
  constructor(parser: MetadataParser) {
    this.parser = parser;
  }

  /**
   * Build a deployment plan with ordered batches
   */
  async buildDeployPlan(selection: string[]): Promise<DeployPlan> {
    const warnings: string[] = [];
    
    // Parse selection into type:name pairs
    const selectedItems = this.parseSelection(selection);
    
    if (selectedItems.length === 0) {
      return {
        batches: [],
        totalItems: 0,
        estimatedSteps: 0,
        warnings: ['No valid items selected for deployment']
      };
    }

    // Gather all references for selected items using RECURSIVE analysis
    // This ensures we find all transitive dependencies (e.g., Bot → Planner → Function → Flow → Apex)
    const allReferences: Reference[] = [];
    const allApexClasses = new Set<string>();
    const allFlows = new Set<string>();
    const allGenAiFunctions = new Set<string>();
    const allGenAiPlugins = new Set<string>();
    const allGenAiPlannerBundles = new Set<string>();

    for (const item of selectedItems) {
      // Use analyzeAllDependencies for recursive dependency analysis
      const depResult = await this.parser.analyzeAllDependencies(item.type, item.name);
      allReferences.push(...depResult.dependencies);
      
      // Collect all discovered dependencies
      depResult.apexClasses.forEach(c => allApexClasses.add(c));
      depResult.flows.forEach(f => allFlows.add(f));
      depResult.genAiFunctions.forEach(f => allGenAiFunctions.add(f));
      depResult.genAiPlugins.forEach(p => allGenAiPlugins.add(p));
      depResult.genAiPlannerBundles.forEach(p => allGenAiPlannerBundles.add(p));
    }

    // Expand selection with ALL discovered dependencies (including transitive ones)
    const expandedItems = await this.expandWithAllDependencies(
      selectedItems, 
      allApexClasses, 
      allFlows, 
      allGenAiFunctions, 
      allGenAiPlugins, 
      allGenAiPlannerBundles,
      warnings
    );
    
    // Group items by metadata type
    const itemsByType = this.groupByType(expandedItems);
    
    // Sort within each type based on dependencies
    const sortedByType = this.sortWithinTypes(itemsByType, allReferences);
    
    // Create batches following the layer order
    const batches = this.createBatches(sortedByType);
    
    return {
      batches,
      totalItems: expandedItems.length,
      estimatedSteps: batches.length,
      warnings
    };
  }

  /**
   * Parse selection strings into typed items
   * Format: "Type:Name" or just "Name" (auto-detect type)
   */
  private parseSelection(selection: string[]): DeployItem[] {
    const items: DeployItem[] = [];
    
    for (const sel of selection) {
      let type: MetadataType;
      let name: string;
      
      if (sel.includes(':')) {
        const [typeStr, nameStr] = sel.split(':', 2);
        type = typeStr as MetadataType;
        name = nameStr;
      } else {
        // Auto-detect type from name pattern
        type = this.inferTypeFromName(sel);
        name = sel;
      }
      
      items.push({
        type,
        name,
        fullName: name,
        filePath: '' // Will be resolved later if needed
      });
    }
    
    return items;
  }

  /**
   * Infer metadata type from naming patterns
   */
  private inferTypeFromName(name: string): MetadataType {
    const lowered = name.toLowerCase();
    
    if (lowered.includes('bot') && lowered.includes('version')) {
      return 'BotVersion';
    }
    if (lowered.includes('bot')) {
      return 'Bot';
    }
    if (lowered.includes('planner')) {
      return 'GenAiPlannerBundle';
    }
    if (lowered.includes('plugin')) {
      return 'GenAiPlugin';
    }
    if (lowered.includes('function') || lowered.includes('func')) {
      return 'GenAiFunction';
    }
    if (lowered.includes('flow')) {
      return 'Flow';
    }
    
    // Default to ApexClass for unknown
    return 'ApexClass';
  }

  /**
   * Expand selection with required dependencies
   */
  private async expandWithDependencies(
    selected: DeployItem[],
    references: Reference[],
    warnings: string[]
  ): Promise<DeployItem[]> {
    const expanded = new Map<string, DeployItem>();
    
    // Add all selected items
    for (const item of selected) {
      const key = `${item.type}:${item.name}`;
      expanded.set(key, item);
    }

    // Add dependencies from references
    for (const ref of references) {
      const key = `${ref.targetType}:${ref.targetName}`;
      if (!expanded.has(key)) {
        expanded.set(key, {
          type: ref.targetType,
          name: ref.targetName,
          fullName: ref.targetName,
          filePath: ''
        });
        warnings.push(`Added dependency: ${ref.targetType}:${ref.targetName} (required by ${ref.sourceName})`);
      }
    }

    // Recursively check for nested dependencies
    // For now, we do a simple pass - could be made recursive if needed
    
    return Array.from(expanded.values());
  }

  /**
   * Expand selection with ALL discovered dependencies from recursive analysis
   * This includes transitive dependencies like Bot → Planner → Function → Flow → Apex
   * Only includes dependencies that exist locally - skips missing ones with warnings
   */
  private async expandWithAllDependencies(
    selected: DeployItem[],
    apexClasses: Set<string>,
    flows: Set<string>,
    genAiFunctions: Set<string>,
    genAiPlugins: Set<string>,
    genAiPlannerBundles: Set<string>,
    warnings: string[]
  ): Promise<DeployItem[]> {
    const expanded = new Map<string, DeployItem>();
    
    // Load local metadata to check existence
    const localApexClasses = await this.parser.listApexClasses();
    const localFlows = await this.parser.listFlows();
    const localGenAiAssets = await this.parser.listGenAiAssets();
    
    // Create lookup sets for faster checking
    const localApexSet = new Set(localApexClasses);
    const localFlowSet = new Set(localFlows);
    const localFunctionSet = new Set(
      localGenAiAssets.filter(a => a.type === 'GenAiFunction').map(a => a.name)
    );
    const localPluginSet = new Set(
      localGenAiAssets.filter(a => a.type === 'GenAiPlugin').map(a => a.name)
    );
    const localPlannerSet = new Set(
      localGenAiAssets.filter(a => a.type === 'GenAiPlannerBundle').map(a => a.name)
    );
    
    // Add all selected items first
    for (const item of selected) {
      const key = `${item.type}:${item.name}`;
      expanded.set(key, item);
    }

    // Add discovered Apex classes (only if they exist locally)
    for (const className of apexClasses) {
      const key = `ApexClass:${className}`;
      if (!expanded.has(key)) {
        if (localApexSet.has(className)) {
          expanded.set(key, {
            type: 'ApexClass',
            name: className,
            fullName: className,
            filePath: ''
          });
          warnings.push(`Added Apex dependency: ${className}`);
        } else {
          warnings.push(`Skipped Apex dependency (not found locally): ${className}`);
        }
      }
    }

    // Add discovered Flows (only if they exist locally)
    for (const flowName of flows) {
      const key = `Flow:${flowName}`;
      if (!expanded.has(key)) {
        if (localFlowSet.has(flowName)) {
          expanded.set(key, {
            type: 'Flow',
            name: flowName,
            fullName: flowName,
            filePath: ''
          });
          warnings.push(`Added Flow dependency: ${flowName}`);
        } else {
          warnings.push(`Skipped Flow dependency (not found locally): ${flowName}`);
        }
      }
    }

    // Add discovered GenAI Functions (only if they exist locally)
    for (const funcName of genAiFunctions) {
      const key = `GenAiFunction:${funcName}`;
      if (!expanded.has(key)) {
        if (localFunctionSet.has(funcName)) {
          expanded.set(key, {
            type: 'GenAiFunction',
            name: funcName,
            fullName: funcName,
            filePath: ''
          });
          warnings.push(`Added GenAiFunction dependency: ${funcName}`);
        } else {
          warnings.push(`Skipped GenAiFunction dependency (not found locally): ${funcName}`);
        }
      }
    }

    // Add discovered GenAI Plugins (only if they exist locally)
    for (const pluginName of genAiPlugins) {
      const key = `GenAiPlugin:${pluginName}`;
      if (!expanded.has(key)) {
        if (localPluginSet.has(pluginName)) {
          expanded.set(key, {
            type: 'GenAiPlugin',
            name: pluginName,
            fullName: pluginName,
            filePath: ''
          });
          warnings.push(`Added GenAiPlugin dependency: ${pluginName}`);
        } else {
          warnings.push(`Skipped GenAiPlugin dependency (not found locally): ${pluginName}`);
        }
      }
    }

    // Add discovered GenAI Planner Bundles (only if they exist locally)
    for (const plannerName of genAiPlannerBundles) {
      const key = `GenAiPlannerBundle:${plannerName}`;
      if (!expanded.has(key)) {
        if (localPlannerSet.has(plannerName)) {
          expanded.set(key, {
            type: 'GenAiPlannerBundle',
            name: plannerName,
            fullName: plannerName,
            filePath: ''
          });
          warnings.push(`Added GenAiPlannerBundle dependency: ${plannerName}`);
        } else {
          warnings.push(`Skipped GenAiPlannerBundle dependency (not found locally): ${plannerName}`);
        }
      }
    }
    
    return Array.from(expanded.values());
  }

  /**
   * Group items by their metadata type
   */
  private groupByType(items: DeployItem[]): Map<MetadataType, DeployItem[]> {
    const groups = new Map<MetadataType, DeployItem[]>();
    
    for (const item of items) {
      const existing = groups.get(item.type) || [];
      existing.push(item);
      groups.set(item.type, existing);
    }
    
    return groups;
  }

  /**
   * Sort items within each type based on dependencies (topological sort)
   */
  private sortWithinTypes(
    itemsByType: Map<MetadataType, DeployItem[]>,
    references: Reference[]
  ): Map<MetadataType, DeployItem[]> {
    const sorted = new Map<MetadataType, DeployItem[]>();
    
    for (const [type, items] of itemsByType) {
      // Build adjacency list for this type
      const graph = new Map<string, Set<string>>();
      const inDegree = new Map<string, number>();
      
      for (const item of items) {
        graph.set(item.name, new Set());
        inDegree.set(item.name, 0);
      }
      
      // Add edges based on references within same type
      for (const ref of references) {
        if (ref.sourceType === type && ref.targetType === type) {
          const edges = graph.get(ref.sourceName);
          if (edges && graph.has(ref.targetName)) {
            edges.add(ref.targetName);
            inDegree.set(ref.targetName, (inDegree.get(ref.targetName) || 0) + 1);
          }
        }
      }
      
      // Topological sort using Kahn's algorithm
      const queue: string[] = [];
      for (const [name, degree] of inDegree) {
        if (degree === 0) queue.push(name);
      }
      
      const sortedNames: string[] = [];
      while (queue.length > 0) {
        const current = queue.shift()!;
        sortedNames.push(current);
        
        const edges = graph.get(current) || new Set();
        for (const neighbor of edges) {
          const newDegree = (inDegree.get(neighbor) || 1) - 1;
          inDegree.set(neighbor, newDegree);
          if (newDegree === 0) queue.push(neighbor);
        }
      }
      
      // If cycle detected, just use original order
      if (sortedNames.length < items.length) {
        sorted.set(type, items);
      } else {
        const itemMap = new Map(items.map(i => [i.name, i]));
        sorted.set(type, sortedNames.map(n => itemMap.get(n)!).filter(Boolean));
      }
    }
    
    return sorted;
  }

  /**
   * Create deployment batches following the layer order
   */
  private createBatches(itemsByType: Map<MetadataType, DeployItem[]>): DeployBatch[] {
    const batches: DeployBatch[] = [];
    let batchNumber = 1;
    
    for (const type of DEPLOYMENT_LAYER_ORDER) {
      const items = itemsByType.get(type);
      if (items && items.length > 0) {
        batches.push({
          batchNumber: batchNumber++,
          metadataType: type,
          items: items
        });
      }
    }
    
    return batches;
  }

  /**
   * Validate a deployment plan
   */
  validatePlan(plan: DeployPlan): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    // Check for empty plan
    if (plan.batches.length === 0) {
      errors.push('Deployment plan is empty');
      return { valid: false, errors };
    }
    
    // Check batch order follows layer order
    let lastLayerIndex = -1;
    for (const batch of plan.batches) {
      const currentIndex = DEPLOYMENT_LAYER_ORDER.indexOf(batch.metadataType);
      if (currentIndex < lastLayerIndex) {
        errors.push(`Invalid batch order: ${batch.metadataType} should come before previous batch`);
      }
      lastLayerIndex = currentIndex;
    }
    
    // Check for duplicate items across batches
    const seen = new Set<string>();
    for (const batch of plan.batches) {
      for (const item of batch.items) {
        const key = `${item.type}:${item.name}`;
        if (seen.has(key)) {
          errors.push(`Duplicate item in plan: ${key}`);
        }
        seen.add(key);
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
}
