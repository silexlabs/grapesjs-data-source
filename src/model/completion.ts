import { Component } from "grapesjs"
import { Context, Expression, Field, Filter, Property, State, StateId, Token, Type, TypeId } from "../types"
import { DataTree } from "./DataTree"
import { getOrCreatePersistantId, getState, getStateIds } from "./state"
import { getExpressionResultType, getTokenOptions } from "./token"

/**
 * Get the context of a component
 * This includes all parents states, data sources queryable values, values provided in the options
 */
export function getContext(component: Component, dataTree: DataTree): Context {
  if (!component) {
    console.error('Component is required for context')
    throw new Error('Component is required for context')
  }
  // Get all queryable values from all data sources
  const queryable: Property[] = dataTree.queryables
    .map((field: Field) => {
      if (!field.dataSourceId) throw new Error(`Type ${field.id} has no data source`)
      return fieldToToken(field)
    })
  // Get all states in the component scope
  const states: State[] = []
  const loopProperties: Token[] = []
  let parent = component
  while (parent) {
    // Get explicitely set states
    states.push(...(getStateIds(parent, true)
      .map((stateId: StateId): State => ({
        type: 'state',
        storedStateId: stateId,
        label: getState(parent, stateId, true)?.label || stateId,
        componentId: getOrCreatePersistantId(parent),
        exposed: true,
      }))))
    // Get states from loops
    //if (parent !== component) {
    const loopDataState = getState(parent, '__data', false)
    if (loopDataState) {
      const loopDataField = getExpressionResultType(loopDataState.expression, parent, dataTree)
      if (loopDataField) {
        if (loopDataField.kind === 'list') {
          loopProperties.push({
            type: 'state',
            storedStateId: '__data',
            componentId: getOrCreatePersistantId(parent),
            exposed: false,
            forceKind: 'object', // FIXME: this may be a scalar
            label: loopDataField.label,
          }, {
            type: 'property',
            propType: 'field',
            fieldId: 'loopindex0',
            label: 'Loop index (0 based)',
            kind: 'scalar',
            typeIds: ['number'],
          }, {
            type: 'property',
            propType: 'field',
            fieldId: 'loopindex',
            label: 'Loop index (starts at 1)',
            kind: 'scalar',
            typeIds: ['number'],
          })
        } else {
          console.warn('Loop data is not a list for component', parent, 'and state', loopDataState)
        }
      } else {
        console.warn('Loop data type not found for component', parent, 'and state', loopDataState)
      }
    }
    //}
    // Go up to parent
    parent = parent.parent() as Component
  }
  // Get filters which accept no input
  const filters: Filter[] = dataTree.filters
    .filter(filter => filter.validate(null))
  // Return the context
  return [
    ...queryable,
    ...states,
    ...loopProperties,
    ...filters,
  ]
}

/**
 * Create a property token from a field
 */
export function fieldToToken(field: Field): Property {
  if (!field) throw new Error('Field is required for token')
  if (!field.dataSourceId) throw new Error(`Field ${field.id} has no data source`)
  return {
    type: 'property',
    propType: 'field',
    fieldId: field.id,
    label: field.label,
    typeIds: field.typeIds,
    dataSourceId: field.dataSourceId,
    kind: field.kind,
    ...getTokenOptions(field) ?? {},
  }
}

/**
 * Auto complete an expression
 * @returns a list of possible tokens to add to the expression
 */
export function getCompletion(component: Component, expression: Expression, dataTree: DataTree, rootType?: TypeId): Context {
  if (!component) throw new Error('Component is required for completion')
  if (!expression) throw new Error('Expression is required for completion')
  if (expression.length === 0) {
    if (rootType) {
      const type = dataTree.getType(rootType)
      if (!type) {
        console.warn('Root type not found', rootType)
        return []
      }
      return type.fields
        .map((field: Field) => fieldToToken(field))
    }
    return getContext(component, dataTree)
  }
  const field = getExpressionResultType(expression, component, dataTree)
  if (!field) {
    console.warn('Result type not found for expression', expression)
    return []
  }
  return ([] as Token[])
    // Add fields if the kind is object
    .concat(field.kind === 'object' ? field.typeIds
      // Find possible types
      .map((typeId: TypeId) => dataTree.getType(typeId, field.dataSourceId))
      // Add all of their fields
      .flatMap((type: Type | null) => type?.fields ?? [])
      // To token
      .flatMap(
        (fieldOfField: Field): Token[] => {
          // const t: Type | null = this.findType(field.typeIds, field.dataSourceId) 
          // if(!t) throw new Error(`Type ${field.typeIds} not found`)
          return fieldOfField.typeIds.map((typeId: TypeId) => ({
            ...fieldToToken(fieldOfField),
            typeIds: [typeId],
          }))
        }
      ) : [])
    // Add filters
    .concat(
      dataTree.filters
        // Match input type
        .filter(filter => filter.validate(field))
    )
}