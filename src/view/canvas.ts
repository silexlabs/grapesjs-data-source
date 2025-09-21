import { Editor, Component } from 'grapesjs'
import { getState, StoredState } from '../model/state'
import { Properties, StoredToken, BinaryOperator, UnariOperator, PREVIEW_RENDER_START, PREVIEW_RENDER_END, PREVIEW_RENDER_ERROR, DataSourceEditorViewOptions } from '../types'
import { fromStored } from '../model/token'
import { evaluateExpressionTokens, EvaluationContext } from '../model/expressionEvaluator'
import { getAllDataSources } from '../model/dataSourceRegistry'
import { getFilters, getPreviewData } from '../model/dataSourceManager'

function getPrivateState(component: Component, stateId: string): StoredState | null {
  return getState(component, stateId, false)
}

// Helper function to evaluate expressions with internal API
function evaluateExpression(expression: StoredToken[], component: Component, resolvePreviewIndex = true): unknown | null {
  try {
    // Convert StoredTokens to full Tokens first, like main branch did
    const tokens = expression.map(token => fromStored(token, component.getId?.() || null))
    const context: EvaluationContext = {
      dataSources: getAllDataSources(),
      filters: getFilters(),
      previewData: getPreviewData(),
      component,
      resolvePreviewIndex,
    }
    return evaluateExpressionTokens(tokens, context)
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
      setPreviewIndexToLoopData(component, loopIndex)
    }
    const value = evaluateCondition(innerHTML.expression, component)
    return value !== null && value !== undefined ? String(value) : null
  } catch (e) {
    console.warn('Error rendering innerHTML:', e)
    return null
  }
}

// Pure function to set preview index on all tokens in a component
// Exprorted for API
function setPreviewIndexToLoopData(component: Component, index: number): void {
  const privateStates = component.get('privateStates') || []
  privateStates.forEach((state: {id: string, expression: StoredToken[]}) => {
    if (state.expression && state.expression.length > 0) {
      setPreviewIndex(state.expression, index)
    }
  })
}

export function setPreviewIndex(expression: StoredToken[], index: number, group?: number) {
  expression.forEach((token: StoredToken & {previewIndex?: number}) => {
    if (token.type === 'state' && token.storedStateId === '__data'
      || (token.type === 'state' && token.storedStateId === 'items')) {
      token.previewIndex = index
      token.previewGroup = group
    } else if (token.type === 'property' || token.type === 'filter') {
      token.previewIndex = index
      token.previewGroup = group
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
    return Array.isArray(result) ? JSON.parse(JSON.stringify(result)) : null
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

// exported for unit tests only
export function renderPreview(comp: Component, deep = 0) {
  const view = comp.view
  if (!view) {
    return
  }
  const el = view.el
  const __data = renderLoopData(comp)

  if (__data) {
    if (__data.length === 0) {
      el.remove()
    } else {
      const initialPreviewIndex = getPreviewIndex(comp) || 0

      // Render each loop iteration
      // Render first iteration in the original element
      // FIXME: as a workaround we need to loop reverse on the __data array, I have no idea why
      const fromIdx = __data.length - 1
      const toIdx = 0

      setPreviewIndexToLoopData(comp, fromIdx)
      const isVisible = isComponentVisible(comp)

      if(isVisible) {
        renderContent(comp, deep)
        renderAttributes(comp)
      } else {
        el.remove()
      }

      // For subsequent iterations: clone first, then render into original, then clone again
      for (let idx = fromIdx - 1; idx >= toIdx; idx--) {
        // Clone the current state (with previous iteration's content)
        const clone = el.cloneNode(true) as HTMLElement

        // Remove grapesjs selected marker from clone and all its children
        clone.classList.remove('gjs-selected')
        const selectedElements = clone.querySelectorAll('.gjs-selected')
        selectedElements.forEach(element => element.classList.remove('gjs-selected'))

        // Keep the selection mechanism - use GrapesJS component API
        clone.addEventListener('click', (event) => {
          const clickedElement = event.target as HTMLElement

          // Find the corresponding GrapesJS component to select
          let targetComponent = comp

          // Look for the component ID directly in the clicked element
          if (clickedElement.id) {
            // Try to find a component with this ID in the entire editor
            const editor = comp.em
            const findComponentById = (comp: Component, id: string): Component | null => {
              if (comp.getId() === id) return comp
              for (const child of comp.components()) {
                const found = findComponentById(child, id)
                if (found) return found
              }
              return null
            }

            // Search from the root of the editor
            const wrapper = editor?.getWrapper()
            const foundComp = wrapper ? findComponentById(wrapper, clickedElement.id) : null
            if (foundComp) {
              targetComponent = foundComp
            } else {
              // Fallback: Use path-based approach
              const path: number[] = []
              let current = clickedElement

              // Build path from clicked element up to clone, but only count elements with gjs attributes
              while (current && current !== clone) {
                const parent = current.parentElement
                if (parent) {
                  const siblings = Array.from(parent.children).filter(child =>
                    child.hasAttribute('data-gjs-type')
                  )
                  const index = siblings.indexOf(current)
                  if (index >= 0) {
                    path.unshift(index)
                  }
                  current = parent
                } else {
                  break
                }
              }

              // Navigate the component tree using the path
              let currentComp = comp
              for (let i = 0; i < path.length; i++) {
                const index = path[i]
                const children = currentComp.components()
                if (index < children.length) {
                  currentComp = children.at(index)
                } else {
                  break
                }
              }

              targetComponent = currentComp
            }
          }

          // Use GrapesJS API to select the component
          setTimeout(() => {
            const editor = targetComponent.em
            if (editor) {
              editor.setSelected(targetComponent)
            }
          })
          event.preventDefault()
          event.stopImmediatePropagation()
        })

        // Add the clone to the canvas
        el.insertAdjacentElement('afterend', clone)

        // Set preview index for the next iteration and render into original element
        setPreviewIndexToLoopData(comp, idx)
        const isVisibleAtIdx = isComponentVisible(comp)

        if (isVisibleAtIdx) {
          renderContent(comp, deep)
          renderAttributes(comp)
        } else {
          el.remove()
        }
      }
      setPreviewIndexToLoopData(comp, initialPreviewIndex)
    }
  } else {
    const isVisible = isComponentVisible(comp)

    if(isVisible) {
      renderContent(comp, deep)
      renderAttributes(comp)
    } else {
      el.remove()
    }
  }
}

export function doRender(editor: Editor) {
  if(!editor.getWrapper()?.view?.el) {
    return
  }
  try {
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
let debounceDelay = 500
function debouncedRender(editor: Editor, eventName: string) {
  if (renderTimeoutId) clearTimeout(renderTimeoutId)
  renderTimeoutId = setTimeout(() => {
    console.info('Refresh preview started because of event', eventName)
    doRender(editor)
    renderTimeoutId = null
  }, debounceDelay)
}

export default (editor: Editor, opts: DataSourceEditorViewOptions) => {
  const events = opts.previewRefreshEvents!.split(' ')
  for(const eventName of events) {
    editor.on(eventName, () => {
      debouncedRender(editor, eventName)
    })
  }
  setTimeout(() => {
    debounceDelay = opts.previewDebounceDelay!
  }, 1000)
}
