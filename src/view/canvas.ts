import { Editor, Component } from 'grapesjs'
import { getState, StoredState } from '../model/state'
import { Properties, StoredToken, Token, BinaryOperator, UnariOperator, PREVIEW_RENDER_START, PREVIEW_RENDER_END, PREVIEW_RENDER_ERROR, DataSourceEditorViewOptions } from '../types'
import { fromStored } from '../model/token'
import { evaluateExpressionTokens, EvaluationContext } from '../model/expressionEvaluator'
import { getAllDataSources } from '../model/dataSourceRegistry'
import { getFilters, getPreviewData } from '../model/dataSourceManager'

function getPrivateState(component: Component, stateId: string): StoredState | null {
  return getState(component, stateId, false)
}

// Caches for performance optimization
const expressionCache = new Map<string, unknown>()
const fromStoredCache = new Map<string, Token>()
let cacheVersion = 0

// Clear caches when data changes
function clearCaches() {
  expressionCache.clear()
  fromStoredCache.clear()
  cacheVersion++
}

// Memoized fromStored conversion
function memoizedFromStored(token: StoredToken, componentId: string | null): Token {
  const cacheKey = `${JSON.stringify(token)}-${componentId}-${cacheVersion}`

  if (fromStoredCache.has(cacheKey)) {
    return fromStoredCache.get(cacheKey)!
  }

  const result = fromStored(token, componentId)
  fromStoredCache.set(cacheKey, result)
  return result
}

// Helper function to evaluate expressions with internal API + caching
function evaluateExpression(expression: StoredToken[], component: Component, resolvePreviewIndex = true): unknown | null {
  // Create cache key for this specific evaluation
  const cacheKey = `${JSON.stringify(expression)}-${component.getId()}-${resolvePreviewIndex}-${cacheVersion}`

  if (expressionCache.has(cacheKey)) {
    return expressionCache.get(cacheKey)
  }

  try {
    // Convert StoredTokens to full Tokens with memoization
    const tokens = expression.map(token => memoizedFromStored(token, component.getId?.() || null))
    const context: EvaluationContext = {
      dataSources: getAllDataSources(),
      filters: getFilters(),
      previewData: getPreviewData(),
      component,
      resolvePreviewIndex,
    }
    const result = evaluateExpressionTokens(tokens, context)
    expressionCache.set(cacheKey, result)
    return result
  } catch (e) {
    console.warn('Error evaluating expression:', e)
    return null
  }
}

// Pure function to evaluate a single condition
function evaluateCondition(expression: StoredToken[], component: Component): unknown | null {
  return evaluateExpression(expression, component, true)
}

// Pure function to render innerHTML for a component at a specific loop index
function renderInnerHTML(component: Component, loopIndex?: number): string | null {
  const innerHTML = getPrivateState(component, Properties.innerHTML)
  if (innerHTML === null) {
    return null
  }
  try {
    // Set preview index for loop context
    if (typeof loopIndex === 'number') {
      setPreviewIndex(component, loopIndex)
    }
    const value = evaluateCondition(innerHTML.expression, component)
    return value !== null && value !== undefined ? String(value) : null
  } catch (e) {
    console.warn('Error rendering innerHTML:', e)
    return null
  }
}

// Pure function to set preview index on all tokens in a component
function setPreviewIndex(component: Component, index: number): void {
  const privateStates = component.get('privateStates') || []
  privateStates.forEach((state: {id: string, expression: StoredToken[]}) => {
    if (state.expression && state.expression.length > 0) {
      state.expression.forEach((token: StoredToken & {previewIndex?: number}) => {
        if (token.type === 'state' && token.storedStateId === '__data') {
          token.previewIndex = index
        } else if (token.type === 'property' || token.type === 'filter') {
          token.previewIndex = index
        }
      })
    }
  })
}

function getPreviewIndex(component: Component): number | undefined {
  const privateStates = component.get('privateStates') || []
  for (const state of privateStates) {
    if (state.expression && state.expression.length > 0) {
      for (const token of state.expression) {
        if (
          (token.type === 'state' && token.storedStateId === '__data') ||
          token.type === 'property' ||
          token.type === 'filter'
        ) {
          return token.previewIndex
        }
      }
    }
  }
  return undefined
}

function renderLoopData(
  component: Component,
): unknown[] | null {
  try {
    const __data = getPrivateState(component, Properties.__data)!
    if (__data === null) {
      return null
    }

    const result = evaluateExpression(__data.expression, component, false) // Get full array

    // Early return for empty arrays - major performance boost
    if (!Array.isArray(result) || result.length === 0) {
      return result && Array.isArray(result) ? [] : null
    }

    return JSON.parse(JSON.stringify(result))
  } catch (e) {
    console.warn('Error getting loop data:', e)
    return null
  }
}

// Export for tests
export function isComponentVisible(
  component: Component,
): boolean {
  const condition1State = getPrivateState(component, Properties.condition)
  const condition2State = getPrivateState(component, Properties.condition2)
  const conditionOperator = component.get('conditionOperator')

  // If no condition is set, component is visible
  if (!condition1State || !condition1State?.expression || condition1State?.expression.length === 0) {
    return true
  }

  let condition1Value: unknown
  try {
    condition1Value = evaluateExpression(condition1State.expression, component, true)
  } catch (e) {
    console.warn('Error evaluating condition1:', e)
    // If condition evaluation fails but no operator is set, default to visible
    if (conditionOperator === undefined || conditionOperator === null) {
      return true
    }
    // For explicit operators, treat failed evaluation as falsy
    condition1Value = null
  }

  // For unary operators, only condition1 is needed
  switch (conditionOperator) {
  case UnariOperator.TRUTHY:
    return !!condition1Value
  case UnariOperator.FALSY:
    return !condition1Value
  case UnariOperator.EMPTY_ARR:
    return Array.isArray(condition1Value) && condition1Value.length === 0
  case UnariOperator.NOT_EMPTY_ARR:
    return Array.isArray(condition1Value) && condition1Value.length > 0
  case undefined:
  case null:
    // If no operator is specified but condition1 exists, default to TRUTHY behavior
    return !!condition1Value
  default:
  }

  // For binary operators, we need condition2
  if (!condition2State || !condition2State.expression || condition2State.expression.length === 0) {
    return false
  }

  let condition2Value: unknown
  try {
    condition2Value = evaluateExpression(condition2State.expression, component, true)
  } catch (e) {
    console.warn('Error evaluating condition2:', e)
    // If condition2 evaluation fails, treat as falsy
    condition2Value = null
  }

  // Apply binary operator
  switch (conditionOperator) {
  case BinaryOperator.EQUAL:
    return condition1Value == condition2Value
  case BinaryOperator.NOT_EQUAL:
    return condition1Value !== condition2Value
  case BinaryOperator.GREATER_THAN:
    return Number(condition1Value) > Number(condition2Value)
  case BinaryOperator.LESS_THAN:
    return Number(condition1Value) < Number(condition2Value)
  case BinaryOperator.GREATER_THAN_OR_EQUAL:
    return Number(condition1Value) >= Number(condition2Value)
  case BinaryOperator.LESS_THAN_OR_EQUAL:
    return Number(condition1Value) <= Number(condition2Value)
  default:
    throw new Error(`Unknown operator ${conditionOperator}`)
  }
}

function renderAttributes(
  component: Component,
): void {
  const privateStates = component.get('privateStates') || []
  privateStates.forEach((state: {id: string, expression: StoredToken[], label?: string}) => {
    // Skip condition states and internal data states - they should not become HTML attributes
    if (state.id &&
        state.id !== Properties.innerHTML &&
        state.id !== Properties.__data &&
        state.id !== Properties.condition &&
        state.id !== Properties.condition2 &&
        state.expression) {
      try {
        const value = evaluateExpression(state.expression, component, true)
        if (value !== null && value !== undefined) {
          component.view?.el.setAttribute(state.label || state.id, String(value))
        }
      } catch (e) {
        console.warn(`Error evaluating attribute ${state.id}:`, e)
      }
    }
  })
}

// // Helper to extend a component instance
// function extendComponent(comp: Component, onRender: (c: Component) => void) {
//   // Extend view
//   if (comp.view) {
//     const origOnRender = comp.view.onRender?.bind(comp.view)
//     comp.view.onRender = function (opts: ClbObj) {
//       if (origOnRender) origOnRender(opts)
//       onRender(comp)
//     }
//   }
// }
//
// /**
//  * Applies extended model/view logic to all existing components in the editor.
//  * @param editor The GrapesJS editor instance
//  */
// function extendAllComponents(editor: Editor, onRender: (c: Component) => void, parents: Components = editor.getComponents()) {
//   parents.forEach((comp) => {
//     extendComponent(comp, onRender)
//     extendAllComponents(editor, onRender, comp.components())
//   })
// }
//

function renderContent(comp: Component, deep: number) {
  const innerHtml = renderInnerHTML(comp)

  if (innerHtml === null) {
    comp.view!.render()
    comp.components()
      .forEach(c => renderPreview(c, deep+1))
  } else {
    comp.view!.el.innerHTML = innerHtml!
  }
}

// Component render cache to avoid unnecessary re-renders
const renderCache = new Map<string, {
  html: string,
  lastDataHash: string,
  lastExpressionHash: string
}>()

function getComponentCacheKey(comp: Component): string {
  return `${comp.getId()}-${comp.get('updated_at') || 0}`
}

function getDataHash(data: unknown): string {
  return JSON.stringify(data).substring(0, 100) // Quick hash
}

function getExpressionHash(comp: Component): string {
  const states = comp.get('privateStates') || []
  return JSON.stringify(states).substring(0, 100)
}

// Batch DOM operations for better performance
const domOperationQueue: Array<() => void> = []
let domBatchScheduled = false

function queueDOMOperation(operation: () => void) {
  domOperationQueue.push(operation)
  if (!domBatchScheduled) {
    domBatchScheduled = true
    requestAnimationFrame(() => {
      const operations = domOperationQueue.splice(0)
      operations.forEach(op => op())
      domBatchScheduled = false
    })
  }
}

// exported for unit tests only
export function renderPreview(comp: Component, deep = 0) {
  const view = comp.view
  if (!view) {
    return
  }
  const el = view.el
  const __data = renderLoopData(comp)

  if (__data) {
    // Early exit for empty arrays - huge performance boost
    if (__data.length === 0) {
      queueDOMOperation(() => el.remove())
      return
    }

    const initialPreviewIndex = getPreviewIndex(comp) || 0

    // Limit rendering for very large datasets to prevent browser freeze
    const maxRenderItems = 50 // Render max 50 items at once
    const dataToRender = __data.length > maxRenderItems ? __data.slice(0, maxRenderItems) : __data

    // Check if we can skip re-rendering based on cache
    const cacheKey = getComponentCacheKey(comp)
    const dataHash = getDataHash(dataToRender)
    const exprHash = getExpressionHash(comp)
    const cached = renderCache.get(cacheKey)

    if (cached && cached.lastDataHash === dataHash && cached.lastExpressionHash === exprHash) {
      return // Skip re-render
    }

    // Batch DOM operations for loop rendering
    queueDOMOperation(() => {
      const fromIdx = dataToRender.length - 1
      const toIdx = 0

      // Clean up existing clones first
      let next = el.nextElementSibling
      while (next && next.classList.contains('loop-clone')) {
        const toRemove = next
        next = next.nextElementSibling
        toRemove.remove()
      }

      setPreviewIndex(comp, fromIdx)
      if (isComponentVisible(comp)) {
        renderContent(comp, deep)
        renderAttributes(comp)
      } else {
        el.remove()
        return
      }

      // Create clones for remaining iterations
      for (let idx = fromIdx - 1; idx >= toIdx; idx--) {
        const clone = el.cloneNode(true) as HTMLElement
        clone.classList.remove('gjs-selected')
        clone.classList.add('loop-clone') // Mark as clone for cleanup

        clone.addEventListener('click', () => {
          setTimeout(() => el.dispatchEvent(new MouseEvent('click', {bubbles: true})))
        })

        el.insertAdjacentElement('afterend', clone)

        setPreviewIndex(comp, idx)
        if (isComponentVisible(comp)) {
          renderContent(comp, deep)
          renderAttributes(comp)
        } else {
          el.remove()
          return
        }
      }

      setPreviewIndex(comp, initialPreviewIndex)

      // Update cache
      renderCache.set(cacheKey, {
        html: el.outerHTML,
        lastDataHash: dataHash,
        lastExpressionHash: exprHash,
      })
    })
  } else {
    if (isComponentVisible(comp)) {
      renderContent(comp, deep)
      renderAttributes(comp)
    } else {
      queueDOMOperation(() => el.remove())
    }
  }
}

export function doRender(editor: Editor) {
  if(!editor.getWrapper()?.view?.el) {
    return
  }
  try {
    // Clear caches at start of render to ensure fresh data
    clearCaches()
    renderCache.clear()

    editor.trigger(PREVIEW_RENDER_START)
    renderPreview(editor.getWrapper()!)

    requestAnimationFrame(() => {
      editor.trigger(PREVIEW_RENDER_END)
    })
  } catch (err) {
    editor.trigger(PREVIEW_RENDER_ERROR, err)
    console.error('Error during preview render:', err)
  }
}

let renderTimeoutId: NodeJS.Timeout | null = null
let debounceDelay = 100 // Reduced debounce for better UX
function debouncedRender(editor: Editor) {
  if (renderTimeoutId) clearTimeout(renderTimeoutId)
  renderTimeoutId = setTimeout(() => {
    doRender(editor)
    renderTimeoutId = null
  }, debounceDelay)
}

export default (editor: Editor, opts: DataSourceEditorViewOptions) => {
  const events = opts.previewRefreshEvents!.split(' ')
  for(const eventName of events) {
    editor.on(eventName, () => {
      debouncedRender(editor)
    })
  }
  setTimeout(() => {
    debounceDelay = opts.previewDebounceDelay!
  }, 1000)
}
