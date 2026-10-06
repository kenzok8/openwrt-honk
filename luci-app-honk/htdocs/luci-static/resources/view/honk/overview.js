// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require network';
'require poll';
'require view';
'require view.honk.rpc as honk';

function getNetworkNames(networks) {
	if (!networks)
		return [];

	const list = Array.isArray(networks) ? networks : Object.keys(networks).map(function(key) { return networks[key]; });
	return list.map(function(net) {
		if (net && typeof net.getName === 'function')
			return net.getName();
		if (net && typeof net.name === 'string')
			return net.name;
		return typeof net === 'string' ? net : '';
	}).filter(function(name, index, names) {
		return !!name && names.indexOf(name) === index;
	}).sort();
}

function metaItem(label, value) {
	return E('span', { 'class': 'honk-meta-item' }, [
		E('span', { 'class': 'honk-meta-label' }, label),
		value == null || value === '' ? '—' : String(value)
	]);
}

function field(label, input, help) {
	const row = E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title', 'for': input.id }, label),
		E('div', { 'class': 'cbi-value-field' }, input)
	]);
	if (help)
		row.appendChild(E('div', { 'class': 'cbi-value-description honk-note' }, help));
	return row;
}

function captureFields(root) {
	const values = {};
	Array.prototype.forEach.call(root.querySelectorAll('input, select, textarea'), function(input) {
		const key = input.id || input.name;
		if (!key)
			return;

		values[key] = {
			value: input.value,
			checked: input.checked,
			focused: document.activeElement === input,
			selectionStart: typeof input.selectionStart === 'number' ? input.selectionStart : null,
			selectionEnd: typeof input.selectionEnd === 'number' ? input.selectionEnd : null
		};
	});
	return values;
}

function restoreFields(root, values) {
	Object.keys(values).forEach(function(key) {
		const input = root.querySelector('#%s'.format(key));
		if (!input || input.type === 'file')
			return;

		input.value = values[key].value;
		input.checked = values[key].checked;
		if (values[key].focused) {
			input.focus();
			if (values[key].selectionStart !== null && typeof input.setSelectionRange === 'function')
				input.setSelectionRange(values[key].selectionStart, values[key].selectionEnd);
		}
	});
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return Promise.all([
			honk.status().then(function(status) { return { status: status }; }).catch(function(error) { return { error: error.message || String(error) }; }),
			network.getNetworks().then(getNetworkNames).then(function(networks) { return { networks: networks }; }).catch(function() { return { networks: [] }; })
		]).then(function(results) {
			return Object.assign({}, results[0], results[1]);
		});
	},

	render: function(data) {
		honk.installStyles();
		const page = E('div', { 'class': 'cbi-map honk-page' });
		const statusArea = E('div');
		const actionMessage = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, '');
		const setupArea = E('div');
		let currentStatus = data.status;
		let busy = false;
		let setupBusy = false;
		let settingsBusy = false;
		let setupState = null;

		function renderStatus(status, error) {
			const fields = captureFields(statusArea);
			const focusedAction = statusArea.contains(document.activeElement) && document.activeElement.dataset.action;
			while (statusArea.firstChild)
				statusArea.removeChild(statusArea.firstChild);

			if (error) {
				statusArea.appendChild(E('div', { 'class': 'alert-message' }, _('Could not read Honk status.')));
				restoreFields(statusArea, fields);
				return;
			}

			currentStatus = status;
			const running = status.running === true;

			/* Status card */
			const badge = E('span', {
				'class': 'honk-badge %s'.format(running ? 'honk-badge--run' : 'honk-badge--stop')
			}, running ? _('Running') : _('Stopped'));

			const webUi = honk.localWebUi(status);
			const openDoona = E(webUi ? 'a' : 'button', {
				'class': 'cbi-button cbi-button-action',
				'href': webUi || null,
				'target': webUi ? '_blank' : null,
				'rel': webUi ? 'noopener noreferrer' : null,
				'type': webUi ? null : 'button',
				'disabled': webUi ? null : true
			}, _('Open Doona'));

			const toggle = E('button', {
				'class': 'cbi-button cbi-button-action',
				'type': 'button',
				'data-action': running ? 'stop' : 'start'
			}, running ? _('Stop') : _('Start'));
			toggle.disabled = busy || !status.initialized;
			toggle.addEventListener('click', function(ev) {
				ev.preventDefault();
				runAction(running ? 'stop' : 'start');
			});

			const actions = [ openDoona, toggle ];
			if (running) {
				const restart = E('button', { 'class': 'cbi-button', 'type': 'button', 'data-action': 'restart' }, _('Restart'));
				restart.disabled = busy;
				restart.addEventListener('click', function(ev) {
					ev.preventDefault();
					runAction('restart');
				});
				actions.push(restart);
			}

			const statusCard = E('section', { 'class': 'honk-card' }, [
				E('div', { 'class': 'honk-card-head' }, [
					E('div', {}, [
						E('h3', { 'class': 'honk-card-title' }, _('Status')),
						badge
					]),
					E('div', { 'class': 'honk-actions' }, actions)
				]),
				E('div', { 'class': 'honk-meta' }, [
					metaItem(_('Core version'), status.core_version),
					metaItem(_('Doona version'), status.doona_version),
					metaItem(_('Kernel'), status.kernel)
				])
			]);

			if (!webUi) {
				const reason = !status.initialized ? _('Complete initial setup before opening Doona.') :
					!running ? _('Start Honk to open Doona.') : _('Doona is not ready yet. Check the service status.');
				statusCard.appendChild(E('p', { 'class': 'honk-note', 'role': 'status' }, reason));
			}

			const errors = (Array.isArray(status.errors) ? status.errors : []).filter(function(token) {
				return token !== 'disabled' && token !== 'not_initialized' && token !== 'service_not_running';
			});
			if (errors.length)
				statusCard.appendChild(E('ul', { 'class': 'alert-message' }, errors.map(function(token) {
					return E('li', {}, honk.statusIssue(token));
				})));

			statusArea.appendChild(statusCard);
			statusArea.appendChild(renderServiceSettings(status));

			if (focusedAction) {
				const replacement = statusArea.querySelector('[data-action="%s"]'.format(focusedAction));
				if (replacement)
					replacement.focus();
			}
			restoreFields(statusArea, fields);
		}

		function renderServiceSettings(status) {
			const card = E('section', { 'class': 'honk-card' });
			const form = E('form');
			const networkSelect = E('select', { 'class': 'cbi-input-select', 'name': 'lan_network', 'id': 'honk-lan-network' });
			const portInput = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'name': 'listen_port', 'id': 'honk-listen-port', 'min': '1024', 'max': '65535', 'step': '1' });
			const bootEnabledInput = E('input', { 'type': 'checkbox', 'name': 'boot_enabled', 'id': 'honk-boot-enabled' });
			const message = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, '');
			const save = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'submit' }, _('Save service settings'));

			(data.networks || []).forEach(function(name) {
				networkSelect.appendChild(E('option', { 'value': name }, name));
			});
			if (status.lan_network && !(data.networks || []).includes(status.lan_network))
				networkSelect.appendChild(E('option', { 'value': status.lan_network }, status.lan_network));
			if (status.lan_network)
				networkSelect.value = status.lan_network;
			portInput.value = status.listen_port ? String(status.listen_port) : '9527';
			bootEnabledInput.checked = status.boot_enabled === true;

			card.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Service settings')));
			if (!(data.networks || []).length)
				networkSelect.appendChild(E('option', { 'value': '' }, _('No network interfaces found')));
			form.appendChild(field(_('LAN network'), networkSelect));
			form.appendChild(field(_('Listen port'), portInput));
			form.appendChild(field(_('Start Honk at boot'), bootEnabledInput));
			form.appendChild(E('div', { 'class': 'cbi-page-actions' }, save));
			form.appendChild(message);
			form.addEventListener('submit', function(ev) {
				ev.preventDefault();
				const port = Number(portInput.value);
				if (!networkSelect.value || !Number.isInteger(port) || port < 1024 || port > 65535) {
					message.textContent = _('Choose a LAN network and a port from 1024 to 65535.');
					return;
				}

				save.disabled = true;
				settingsBusy = true;
				message.textContent = _('Saving…');
				honk.settings(networkSelect.value, port, bootEnabledInput.checked).then(honk.ensureOk).then(function(result) {
					message.textContent = honk.resultMessage(result, _('Service settings saved.'));
				}).catch(function(error) {
					message.textContent = honk.errorMessage(error, _('Settings could not be applied.'));
				}).finally(function() {
					settingsBusy = false;
					save.disabled = false;
					refresh();
				});
			});
			card.appendChild(form);
			return card;
		}

		function renderSetup(status) {
			if (setupBusy)
				return;
			if (!status)
				return;
			const initialized = status.initialized === true;
			if (setupState === initialized)
				return;
			setupState = initialized;
			const fields = captureFields(setupArea);
			while (setupArea.firstChild)
				setupArea.removeChild(setupArea.firstChild);

			if (initialized)
				return;

			const form = E('form', { 'class': 'honk-card' });
			const username = E('input', { 'type': 'text', 'name': 'username', 'id': 'honk-init-username', 'autocomplete': 'username', 'required': true, 'class': 'cbi-input-text' });
			const password = E('input', { 'type': 'password', 'name': 'password', 'id': 'honk-init-password', 'autocomplete': 'new-password', 'required': true, 'class': 'cbi-input-password' });
			const message = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, '');
			const submit = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'submit' }, _('Initialize Honk'));
			form.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Initial setup')));
			form.appendChild(E('p', { 'class': 'honk-note' }, _('Create the Honk administrator account. The password is sent only for this request and is not saved by this page.')));
			form.appendChild(field(_('Username'), username));
			form.appendChild(field(_('Password'), password));
			form.appendChild(E('div', { 'class': 'cbi-page-actions' }, submit));
			form.appendChild(message);
			form.addEventListener('submit', function(ev) {
				ev.preventDefault();
				const user = username.value.trim();
				const secret = password.value;
				if (!user || !secret) {
					message.textContent = _('Enter both a username and password.');
					return;
				}

				submit.disabled = true;
				setupBusy = true;
				message.textContent = _('Initializing…');
				honk.initialize(user, secret).then(honk.ensureOk).then(function(result) {
					username.value = '';
					password.value = '';
					message.textContent = honk.resultMessage(result, _('Honk initialized.'));
					return honk.status();
				}).then(function(updatedStatus) {
					setupBusy = false;
					currentStatus = updatedStatus;
					renderSetup(updatedStatus);
					renderStatus(updatedStatus, null);
				}).catch(function() {
					password.value = '';
					message.textContent = _('Initialization failed. Check the system status.');
				}).finally(function() {
					setupBusy = false;
					submit.disabled = false;
				});
			});
			setupArea.appendChild(form);
			restoreFields(setupArea, fields);
		}

		function refresh() {
			if (busy || setupBusy || settingsBusy)
				return Promise.resolve();
			return honk.status().then(function(status) {
				renderStatus(status, null);
				renderSetup(status);
			}).catch(function() {
				renderStatus(null, true);
			});
		}

		function runAction(method) {
			if (busy)
				return;
			busy = true;
			actionMessage.textContent = _('Working…');
			renderStatus(currentStatus, null);
			honk[method]().then(honk.ensureOk).then(function(result) {
				actionMessage.textContent = honk.resultMessage(result, _('Operation completed.'));
			}).catch(function(error) {
				actionMessage.textContent = honk.errorMessage(error, _('Operation failed. Check Honk status.'));
			}).finally(function() {
				busy = false;
				refresh();
			});
		}

		page.appendChild(E('div', { 'class': 'honk-header' }, [
			E('h2', {}, _('Honk')),
			E('p', { 'class': 'honk-header-sub' }, _('Transparent proxy core for OpenWrt. Start, stop and manage the Honk service.'))
		]));
		page.appendChild(statusArea);
		page.appendChild(actionMessage);
		page.appendChild(setupArea);
		renderStatus(data.status, data.error);
		if (data.status)
			renderSetup(data.status);
		poll.add(refresh, 5);
		return page;
	}
});
