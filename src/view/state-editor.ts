/*
 * Silex website builder, free/libre no-code tool for makers.
 * Copyright (c) 2023 lexoyo and Silex Labs foundation
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import {LitElement, TemplateResult, html} from 'lit'
import {customElement, property} from 'lit/decorators.js'
import { PROPERTY_STYLES } from './defaultStyles'
import { DataSourceEditor, Filter, Property, Token } from '..'

import { Ref, createRef, ref } from 'lit/directives/ref.js'
import { styleMap } from 'lit/directives/style-map.js'
import { FIXED_TOKEN_ID, fromString, getFixedToken, getTokenDisplayName, groupByType, toId, toValue } from '../utils'
import { ExpressionInput } from '@silexlabs/expression-input'
import { Component } from 'grapesjs'
import { PopinForm } from '@silexlabs/expression-input/dist/popin-form'

import '@silexlabs/expression-input'
import { getCompletion } from '../model/completion'
import { getExpressionResultType } from '../model/token'

/**
 * Editor for a state of the selected element's properties
 * 
 * Usage:
 * 
 * ```
 * <properties-editor disabled>
 *   <style> / * Custom styles * / </style>
 * </properties-editor>
 * ```
 * 
 */

@customElement('state-editor')
export class StateEditor extends LitElement {
  @property({type: Boolean})
  disabled = false

  @property({type: String})
  name = ''

  @property({type: Boolean, attribute: 'no-filters'})
  noFilters = false

  @property({type: String, attribute: 'root-type'})
  rootType = ''

  @property({type: Boolean, attribute: 'default-fixed'})
  defaultFixed = false

  /**
   * Value string for for submissions
   */
  @property()
  get value(): string {
    return JSON.stringify(this.data)
  }
  set value(newValue: string) {
    try {
      this.data = JSON.parse(newValue)
    } catch(e) {
      this.data = newValue
    }
  }

  /**
   * Structured data
   */
  private _data: Token[] = []
  get data(): Token[] {
    const input = this.expressionInputRef.value
    if(!input) return []
    if(input.fixed) {
      return [getFixedToken(input.value[0] || '')]
    } else {
      const ids = input.value
      return ids
        .filter(id => !!id)
        .map(id => {
          try {
            return fromString(this.editor!, id)
          } catch(e) {
            // FIXME: notify user
            console.error(`Error while getting token from id ${id}`, e)
            // Return unknown
            return {
              type: 'property',
              propType: 'field',
              fieldId: 'unknown',
              label: 'Unknown',
              kind: 'scalar',
              typeIds: [],
              options: {},
            } as Property
          }
        })
        // Here the data is missing options as data comes from completion
        // Add the options
        .map((token, idx) => {
          const popin = this.popinsRef[idx]?.value
          switch(token.type) {
            case 'property':
            case 'filter':
              token.options = popin?.value || token.options
              break
            default:
              break
          }
          return token
        })
    }
  }
  set data(value: Token[] | string) {
    if(typeof value === 'string') {
      this._data = value === '' ? [] : [getFixedToken(value)]
    } else {
      this._data = value
    }
    this.requestUpdate()
  }

  @property({type: Object})
  public editor: DataSourceEditor | null = null

  private redrawing = false
  private expressionInputRef = createRef<ExpressionInput>()
  private popinsRef: Ref<PopinForm>[] = []

  setEditor(editor: DataSourceEditor) {
    if (this.editor) {
      return
    }

    this.editor = editor
  }

  override render() {
    this.redrawing = true
    super.render()
    if(!this.editor) {
      throw new Error('editor not set')
    }
    const selected = this.editor.getSelected() ?? this.editor.Pages.getSelected()?.getMainComponent()
    if(!selected) {
      throw new Error('no selected component, is there no "body" or page selected?')
    }
    if(!this.name) {
      throw new Error('name is required on state-editor')
    }
    const dataTree = this.editor.DataSourceManager.getDataTree()
    const _currentValue = this._data

    // Get the data to show in the "+" drop down
    const rawCompletion = getCompletion(selected, _currentValue || [], dataTree, this.rootType)
    const completion = this.noFilters ? rawCompletion
      .filter(token => token.type !== 'filter')
      : rawCompletion
    const groupedCompletion = groupByType(this.editor, selected, completion, _currentValue)

    // Check if the expression has a fixed value and nothing else
    const fixed = (_currentValue?.length === 1 && _currentValue[0].type === 'property' && _currentValue[0].fieldId === FIXED_TOKEN_ID)
      // If the value is empty and the default is fixed, then the input is fixed
      || (this.defaultFixed && _currentValue.length === 0)
      // If there is no completion and the value is empty
      || (completion.length === 0 && _currentValue.length === 0)

    // Fixed text
    const text = fixed ? (_currentValue![0] as Property)?.options?.value || '' : ''

    // Build the expression input
    const result = html`
      <expression-input
        @change=${(event: Event) => this.onChangeValue(event)}
        data-is-input
        ${ref(this.expressionInputRef)}
        .fixed=${fixed}
        class="ds-section"
        name=${this.name}
        reactive
      >
        <style>
          ${PROPERTY_STYLES}
        </style>
        <slot name="label" slot="label"></slot>
        <div slot="fixed" class="ds-slot-fixed">
          <input
            type="text"
            class="ds-expression-input__fixed"
            placeholder="Enter a text or switch to expression mode"
            .value=${text}
            />
        </div>
        ${ _currentValue && _currentValue.length > 0 ? html`
          ${ _currentValue.map((token: Token, idx: number) => {
            this.popinsRef[idx] = createRef<PopinForm>()
            const optionsForm = this.getOptions(selected, _currentValue, idx)
            const partialExpression = _currentValue.slice(0, idx)
            const _partialCompletion = getCompletion(selected, partialExpression, dataTree, this.rootType)
            const partialCompletion = this.noFilters ? _partialCompletion
              .filter(token => token.type !== 'filter')
              : _partialCompletion
            const partialGroupedCompletion = groupByType(this.editor!, selected, partialCompletion, _currentValue.slice(0, idx))
            const id = toId(token)
            return html`
              <select>
                <option value="">-</option>
                ${ Object.entries(partialGroupedCompletion)
                  .reverse()
                  .map(([type, completion]) => {
                    return html`
                      <optgroup label="${type}">
                      ${ completion
                        .map(partialToken => ({
                          displayName: getTokenDisplayName(selected, partialToken),
                          partialToken,
                        }))
                        .sort((a, b) => a.displayName.localeCompare(b.displayName))
                        .map(({partialToken, displayName}) => {
                          const partialId = toId(partialToken)
                          return html`
                            <option value=${toValue(partialToken)} .selected=${partialId === id}>${displayName}</option>
                          `
                        })
                      }
                      </optgroup>
                    `
                  })
                }
              </select>
              <button
                class="ds-expression-input__options-button"
                style=${styleMap({ display: optionsForm === '' ? 'none' : '' })}
                @click=${() => {
                  this.popinsRef[idx].value?.removeAttribute('hidden')
                }}
              >...</button>
              <popin-form
                ${ref(this.popinsRef[idx])}
                hidden
                name=${`${this.name}_options_${idx}`}
                @change=${(event: Event) => this.onChangeOptions(event, selected, this.popinsRef[idx].value!, idx)}
              >
                ${optionsForm}
              </popin-form>
              `
            })
          }
        ` : '' }
        ${Object.entries(groupedCompletion).length ? html`
          <select
            class="ds-expression-input__add"
            ${ref(el => el && ((el as HTMLSelectElement).value = ''))}
            >
            <option value="" selected>+</option>
            ${ Object.entries(groupedCompletion)
              .reverse()
              .map(([type, completion]) => {
                return html`
                    <optgroup label="${type}">
                    ${ completion
                      .map(token => ({
                        displayName: getTokenDisplayName(selected, token),
                        token,
                      }))
                      .sort((a, b) => a.displayName.localeCompare(b.displayName))
                      .map(({displayName, token}) => {
                        return html`<option value="${toValue(token)}">${displayName}</option>`
                      })
                    }
                    </optgroup>
                `
              })
            }
          </select>
      ` : ''}
      </expression-input>
    `
    this.redrawing = false
    return result
  }

  private onChangeValue(event: Event) {
    if(this.redrawing) return
    const idx = (event as CustomEvent).detail?.idx
    if(idx >= 0) {
      // Custom event coming from the expression input
      // Remove the tokens after the changed one
      this.data = this.data.slice(0, idx + 1)
    } else {
      // Event coming from the options
    }
    event.preventDefault()
    event.stopImmediatePropagation()
    event.stopPropagation()
    this.dispatchEvent(new Event('change', { bubbles: true }))
  }

  private onChangeOptions(event: Event, component: Component, popin: PopinForm, idx: number) {
    if(this.redrawing) return
    const input = this.expressionInputRef.value!
    const tokensStrings = input.value
    // Get tokens as objects
    const tokens = tokensStrings
      .filter(id => !!id)
      .map(id => {
        try {
          return fromString(this.editor!, id)
        } catch(e) {
          // FIXME: notify user
          console.error('Error while getting token from string', {id}, e)
          // Return unknown
          return {
            type: 'property',
            propType: 'field',
            fieldId: 'unknown',
            label: 'Unknown',
            kind: 'scalar',
            typeIds: [],
            options: {},
          } as Property
        }
      })
    // Get the selected options
    const options = input.options
      .filter(o => o.selected)
    // Update the options of the token
    ;(tokens[idx] as Property | Filter).options = popin.value
    // Update the dom
    options[idx].value = toValue(tokens[idx])
    // Update the state
    this.requestUpdate()
    // Stop the original event
    event.preventDefault()
    event.stopImmediatePropagation()
    event.stopPropagation()
    // Notify the owner
    this.dispatchEvent(new Event('change', { bubbles: true }))
  }

  private getOptions(component: Component, tokens: Token[], idx: number): TemplateResult | '' {
    const dataTree = this.editor!.DataSourceManager.getDataTree()
    const token = tokens[idx]
    const beforeToken = tokens.slice(0, idx)
    const fields = beforeToken
      .map(token => {
        try {
          return getExpressionResultType(tokens.concat(token), component, dataTree)
        } catch(e) {
          // FIXME: notify the user
          console.error(`Error while getting expression result type for token ${token} on component ${component.getName()}#${component.get('id')}.${component.getClasses().join('.')} (${component.cid})`, e)
          return null
        }
      })

    switch(token.type) {
      case 'property':
      case 'filter':
        if(token.optionsForm) {
          const form = token.optionsForm(fields[fields.length - 1], token.options || {})
          return form || ''
        }
        return ''
      default:
        return ''
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'state-editor': StateEditor
  }
}
