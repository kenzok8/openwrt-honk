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

function field(label, value) {
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, label),
		E('div', { 'class': 'cbi-value-field' }, value == null || value === '' ? '—' : String(value))
	]);
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
		const page = E('div', { 'class': 'cbi-map' });
		const section = E('div', { 'class': 'cbi-section' });
		const statusArea = E('div');
		const actionMessage = E('p', { 'role': 'status' }, '');
		const setupArea = E('div');
		let currentStatus = data.status;
		let busy = false;
		let setupBusy = false;
		let settingsBusy = false;

		function renderStatus(status, error) {
			const fields = captureFields(statusArea);
			const previousDetails = statusArea.querySelector('details');
			const versionsOpen = previousDetails && previousDetails.open;
			const settingsDetails = statusArea.querySelector('.honk-service-settings');
			const settingsOpen = settingsDetails && settingsDetails.open;
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
			const controls = E('div', { 'class': 'honk-status-controls' });
			const statusRow = E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, _('Service')),
				E('div', {
					'class': 'cbi-value-field',
					'style': 'display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5em'
				}, [
					E('span', {}, running ? _('Running') : _('Stopped')),
					controls
				])
			]);
			statusArea.appendChild(statusRow);

			const versions = E('details', { 'class': 'honk-version-details' }, [
				E('summary', {}, _('Version information')),
				E('div', { 'class': 'cbi-section-node' }, [
					field(_('Core version'), status.core_version),
					field(_('Doona version'), status.doona_version),
					field(_('Kernel'), status.kernel)
				])
			]);
			versions.open = !!versionsOpen;
			statusArea.appendChild(versions);
			statusArea.appendChild(renderServiceSettings(status, settingsOpen));

			const errors = (Array.isArray(status.errors) ? status.errors : []).filter(function(token) {
				return token !== 'disabled' && token !== 'not_initialized' && token !== 'service_not_running';
			});
			if (errors.length)
				statusArea.appendChild(E('ul', { 'class': 'alert-message' }, errors.map(function(token) {
					return E('li', {}, honk.statusIssue(token));
				})));

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
			controls.appendChild(toggle);

			if (running) {
				const restart = E('button', { 'class': 'cbi-button', 'type': 'button', 'data-action': 'restart' }, _('Restart'));
				restart.disabled = busy;
				restart.addEventListener('click', function(ev) {
					ev.preventDefault();
					runAction('restart');
				});
				controls.appendChild(restart);
			}

			if (focusedAction) {
				const replacement = statusArea.querySelector('[data-action="%s"]'.format(focusedAction));
				if (replacement)
					replacement.focus();
			}
			restoreFields(statusArea, fields);
		}

		function renderServiceSettings(status, open) {
			const details = E('details', { 'class': 'honk-service-settings' });
			const form = E('form', { 'class': 'cbi-section-node' });
			const networkSelect = E('select', { 'class': 'cbi-input-select', 'name': 'lan_network' });
			const portInput = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'name': 'listen_port', 'min': '1024', 'max': '65535', 'step': '1' });
			const bootEnabledInput = E('input', { 'type': 'checkbox', 'name': 'boot_enabled' });
			const message = E('p', { 'role': 'status' }, '');
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

			details.appendChild(E('summary', {}, _('Service settings')));
			if (!(data.networks || []).length)
				networkSelect.appendChild(E('option', { 'value': '' }, _('No network interfaces found')));
			form.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': 'honk-lan-network' }, _('LAN network')),
				E('div', { 'class': 'cbi-value-field' }, networkSelect)
			]));
			networkSelect.id = 'honk-lan-network';
			form.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': 'honk-listen-port' }, _('Listen port')),
				E('div', { 'class': 'cbi-value-field' }, portInput)
			]));
			portInput.id = 'honk-listen-port';
			form.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': 'honk-boot-enabled' }, _('Start Honk at boot')),
				E('div', { 'class': 'cbi-value-field' }, bootEnabledInput)
			]));
			bootEnabledInput.id = 'honk-boot-enabled';
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
			details.open = !!open;
			details.appendChild(form);
			return details;
		}

		function renderSetup(status) {
			if (setupBusy)
				return;
			const fields = captureFields(setupArea);
			while (setupArea.firstChild)
				setupArea.removeChild(setupArea.firstChild);

			if (status && status.initialized === true) {
				const webUi = honk.localWebUi(status);
				const entry = E('div', { 'class': 'cbi-section' }, [ E('h3', {}, _('Doona web interface')) ]);
				if (webUi) {
					entry.appendChild(E('p', {}, _('Doona opens its own sign-in page.')));
					entry.appendChild(E('a', {
						'class': 'cbi-button cbi-button-action',
						'href': webUi,
						'target': '_blank',
						'rel': 'noopener noreferrer'
					}, _('Open Doona')));
				}
				else {
					entry.appendChild(E('p', {}, status.running ? _('Doona is not ready yet. Check the service status.') : _('Honk is stopped. Start it to open Doona.')));
				}
				setupArea.appendChild(entry);
				restoreFields(setupArea, fields);
				return;
			}

			const form = E('form', { 'class': 'cbi-section' });
			const username = E('input', { 'type': 'text', 'name': 'username', 'autocomplete': 'username', 'class': 'cbi-input-text' });
			const password = E('input', { 'type': 'password', 'name': 'password', 'autocomplete': 'new-password', 'class': 'cbi-input-password' });
			const message = E('p', { 'role': 'status' }, '');
			const submit = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'submit' }, _('Initialize Honk'));
			form.appendChild(E('h3', {}, _('Initial setup')));
			form.appendChild(E('p', {}, _('Create the Honk administrator account. The password is sent only for this request and is not saved by this page.')));
			form.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': 'honk-init-username' }, _('Username')),
				E('div', { 'class': 'cbi-value-field' }, username)
			]));
			username.id = 'honk-init-username';
			form.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title', 'for': 'honk-init-password' }, _('Password')),
				E('div', { 'class': 'cbi-value-field' }, password)
			]));
			password.id = 'honk-init-password';
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

		section.appendChild(statusArea);
		section.appendChild(actionMessage);
		page.appendChild(E('h2', {}, _('Honk')));
		page.appendChild(section);
		page.appendChild(setupArea);
		renderStatus(data.status, data.error);
		if (data.status)
			renderSetup(data.status);
		poll.add(refresh, 5);
		return page;
	}
});
