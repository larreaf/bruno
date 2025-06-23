import { IconEye, IconEyeOff } from '@tabler/icons';
import cloneDeep from 'lodash/cloneDeep';
import isEqual from 'lodash/isEqual';
import { updateCollectionVar } from 'providers/ReduxStore/slices/collections';
import { saveEnvironment, updateFolderVar, updateVar } from 'providers/ReduxStore/slices/collections/index';
import React, { Component } from 'react';
import { connect } from 'react-redux';
import { findVarByName, getAllVariables } from 'utils/collections';
import { findEnvironmentInCollection } from 'utils/collections/index';
import { defineCodeMirrorBrunoVariablesMode, MaskedEditor } from 'utils/common/codemirror';
import StyledWrapper from './StyledWrapper';

let CodeMirror;
const SERVER_RENDERED = typeof window === 'undefined' || global['PREVENT_CODEMIRROR_RENDER'] === true;

if (!SERVER_RENDERED) {
  CodeMirror = require('codemirror');
}

class SingleLineEditor extends Component {
  constructor(props) {
    super(props);
    // Keep a cached version of the value, this cache will be updated when the
    // editor is updated, which can later be used to protect the editor from
    // unnecessary updates during the update lifecycle.
    this.cachedValue = props.value || '';
    this.editorRef = React.createRef();
    this.variables = {};

    this.state = {
      maskInput: props.isSecret || false // Always mask the input by default (if it's a secret)
    };
  }
  componentDidMount() {
    // Initialize CodeMirror as a single line editor
    /** @type {import("codemirror").Editor} */
    if (!this.props.item) return;
    const item = this.props.item.draft ? this.props.item.draft : this.props.item;
    const variables = getAllVariables(this.props.collection, item);

    // We have an issue. If we update a variable without saving it, getAllVariables wont retrieve it from draft.
    // getAllVariables should retrieve it from draft instead of item if exists.

    const runHandler = () => {
      if (this.props.onRun) {
        this.props.onRun();
      }
    };
    const saveHandler = () => {
      if (this.props.onSave) {
        this.props.onSave();
      }
    };
    const noopHandler = () => {};

    this.editor = CodeMirror(this.editorRef.current, {
      lineWrapping: false,
      lineNumbers: false,
      theme: this.props.theme === 'dark' ? 'monokai' : 'default',
      mode: 'brunovariables',
      brunoVarInfo: {
        variables,
        setVar: this._brunoVarInfoSetVar
      },
      scrollbarStyle: null,
      tabindex: 0,
      extraKeys: {
        Enter: runHandler,
        'Ctrl-Enter': runHandler,
        'Cmd-Enter': runHandler,
        'Alt-Enter': () => {
          if (this.props.allowNewlines) {
            this.editor.setValue(this.editor.getValue() + '\n');
            this.editor.setCursor({ line: this.editor.lineCount(), ch: 0 });
          } else if (this.props.onRun) {
            this.props.onRun();
          }
        },
        'Shift-Enter': runHandler,
        'Cmd-S': saveHandler,
        'Ctrl-S': saveHandler,
        'Cmd-F': noopHandler,
        'Ctrl-F': noopHandler,
        // Tabbing disabled to make tabindex work
        Tab: false,
        'Shift-Tab': false
      }
    });
    if (this.props.autocomplete) {
      this.editor.on('keyup', (cm, event) => {
        if (!cm.state.completionActive /*Enables keyboard navigation in autocomplete list*/ && event.key !== 'Enter') {
          /*Enter - do not open autocomplete list just after item has been selected in it*/
          CodeMirror.commands.autocomplete(cm, CodeMirror.hint.anyword, { autocomplete: this.props.autocomplete });
        }
      });
    }
    this.editor.setValue(String(this.props.value) || '');
    this.editor.on('change', this._onEdit);
    this.addOverlay(variables);
    this._enableMaskedEditor(this.props.isSecret);
    this.setState({ maskInput: this.props.isSecret });
  }

  _brunoVarInfoSetVar = (name, value) => {
    const item = this.props.item.draft ? this.props.item.draft : this.props.item;
    const [variable, origin, itemUid] = findVarByName(this.props.collection, item, name, "request");
    if (origin == 'collection') {
      this.props.dispatch(
        updateCollectionVar({
          type: "request",
          var: {
            uid: variable.uid,
            name: name,
            value: value,
            enabled: true,
          },
          itemUid: itemUid,
          collectionUid: this.props.collection.uid
        })
      );
      return;
    }

    if (origin == 'environment') {
      const environment = findEnvironmentInCollection(this.props.collection, this.props.collection.activeEnvironmentUid);
      const values = environment.variables;
      const index = values.findIndex(v => v.uid == variable.uid);
      const mutated = [
        ...values.slice(0, index), // Items before the index
        {
          ...variable,
          value: value
        },
        ...values.slice(index + 1)
      ]
      this.props.dispatch(saveEnvironment(cloneDeep(mutated), environment.uid, this.props.collection.uid));
      return;
    }

    if (origin == 'folder') {
      this.props.dispatch(
        updateFolderVar({
          type: "request",
          var: {
            uid: variable.uid,
            name: name,
            value: value,
            enabled: true,
          },
          folderUid: itemUid,
          collectionUid: this.props.collection.uid
        })
      )
      return;
    }

    // default
    this.props.dispatch(
      updateVar({
        type: "request",
        var: {
          uid: variable.uid,
          name: name,
          value: value,
          enabled: true,
        },
        itemUid: itemUid,
        collectionUid: this.props.collection.uid
      })
    )
  }

  /** Enable or disable masking the rendered content of the editor */
  _enableMaskedEditor = (enabled) => {
    if (typeof enabled !== 'boolean') return;

    console.log('Enabling masked editor: ' + enabled);
    if (enabled == true) {
      if (!this.maskedEditor) this.maskedEditor = new MaskedEditor(this.editor, '*');
      this.maskedEditor.enable();
    } else {
      this.maskedEditor?.disable();
      this.maskedEditor = null;
    }
  };

  _onEdit = () => {
    if (!this.ignoreChangeEvent && this.editor) {
      this.cachedValue = this.editor.getValue();
      if (this.props.onChange) {
        this.props.onChange(this.cachedValue);
      }
    }
  };

  componentDidUpdate(prevProps) {
    // Ensure the changes caused by this update are not interpreted as
    // user-input changes which could otherwise result in an infinite
    // event loop.
    this.ignoreChangeEvent = true;
    if (!this.props || !this.props.item) return;

    let variables = getAllVariables(this.props.collection, this.props.item);
    if (!isEqual(variables, this.variables)) {
      this.editor.options.brunoVarInfo.variables = variables;
      this.addOverlay(variables);
    }
    if (this.props.theme !== prevProps.theme && this.editor) {
      this.editor.setOption('theme', this.props.theme === 'dark' ? 'monokai' : 'default');
    }
    if (this.props.value !== prevProps.value && this.props.value !== this.cachedValue && this.editor) {
      this.cachedValue = String(this.props.value);
      this.editor.setValue(String(this.props.value) || '');
    }
    if (!isEqual(this.props.isSecret, prevProps.isSecret)) {
      // If the secret flag has changed, update the editor to reflect the change
      this._enableMaskedEditor(this.props.isSecret);
      // also set the maskInput flag to the new value
      this.setState({ maskInput: this.props.isSecret });
    }
    this.ignoreChangeEvent = false;
  }

  componentWillUnmount() {
    // if(!this.editor) return;
    this.editor.getWrapperElement().remove();
  }

  addOverlay = (variables) => {
    this.variables = variables;
    defineCodeMirrorBrunoVariablesMode(variables, 'text/plain', this.props.highlightPathParams);
    this.editor.setOption('mode', 'brunovariables');
  };

  toggleVisibleSecret = () => {
    const isVisible = !this.state.maskInput;
    this.setState({ maskInput: isVisible });
    this._enableMaskedEditor(isVisible);
  };

  /**
   * @brief Eye icon to show/hide the secret value
   * @returns ReactComponent The eye icon
   */
  secretEye = (isSecret) => {
    return isSecret === true ? (
      <button className="mx-2" onClick={() => this.toggleVisibleSecret()}>
        {this.state.maskInput === true ? (
          <IconEyeOff size={18} strokeWidth={2} />
        ) : (
          <IconEye size={18} strokeWidth={2} />
        )}
      </button>
    ) : null;
  };

  render() {
    return (
      <div className="flex flex-row justify-between w-full overflow-x-auto">
        <StyledWrapper ref={this.editorRef} className="single-line-editor grow" />
        {this.secretEye(this.props.isSecret)}
      </div>
    );
  }
}
export default connect()(SingleLineEditor);
