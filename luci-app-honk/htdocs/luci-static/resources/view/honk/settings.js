// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require network';
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

function systemConfigCard() {
	const textarea = E('textarea', {
		'class': 'cbi-input-text', 'rows': 18, 'spellcheck': 'false',
		'style': 'width:100%;font-family:monospace'
	});
	const message = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, '');
	const saveBtn = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'button' }, _('保存并校验'));

	honk.systemRead().then(function(result) {
		textarea.value = (result && result.content) || '';
	}).catch(function(error) {
		message.textContent = honk.errorMessage(error, _('无法读取 system.dae'));
	});

	saveBtn.addEventListener('click', function() {
		saveBtn.disabled = true;
		message.textContent = _('校验并写入…');
		honk.systemSave(textarea.value).then(honk.ensureOk).then(function(result) {
			message.textContent = honk.resultMessage(result, _('已保存，面板不再改写 system.dae'));
			window.setTimeout(function() { location.reload(); }, 1200);
		}).catch(function(error) {
			message.textContent = honk.errorMessage(error, _('保存失败，请查看系统状态'));
		}).finally(function() { saveBtn.disabled = false; });
	});


	return E('div', { 'class': 'honk-card' }, [
		E('h3', { 'class': 'honk-card-title' }, _('system.dae（直接编辑）')),
		E('p', { 'class': 'honk-note' }, _('The active configuration still includes this legacy file. Edit it here, or preview merging it on the configuration page.')),
		textarea,
		E('div', { 'class': 'cbi-page-actions' }, [ saveBtn ]),
		message
	]);
}

function field(label, control, help) {
	const controlId = control.id || (control.querySelector && control.querySelector('input, select, textarea') || {}).id;
	const cell = E('div', { 'class': 'cbi-value-field' }, [ control ]);
	if (help)
		cell.appendChild(E('div', { 'class': 'cbi-value-description honk-note' }, help));
	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title', 'for': controlId || null }, label),
		cell
	]);
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return Promise.all([
			honk.status().then(function(status) { return { status: status }; }).catch(function(error) { return { statusError: error.message || String(error) }; }),
			network.getNetworks().then(getNetworkNames).then(function(names) { return { networks: names }; }).catch(function(error) { return { networkError: error.message || String(error), networks: [] }; })
		]).then(function(results) {
			return Object.assign({}, results[0], results[1]);
		});
	},

	render: function(data) {
		honk.installStyles();
		const page = E('div', { 'class': 'cbi-map honk-page' });
		if (data.status && data.status.initialized) {
			page.appendChild(E('div', { 'class': 'honk-header' }, [
				E('h2', {}, _('Settings')),
				E('p', { 'class': 'honk-header-sub' }, _('Runtime settings are managed in config.dae.'))
			]));
			page.appendChild(E('div', { 'class': 'honk-card' }, [
				E('a', { 'class': 'cbi-button', 'href': L.url('admin/services/honk/configuration') + '#edit' }, _('Edit configuration'))
			]));
			if (data.status.settings_owner === 'system')
				page.appendChild(systemConfigCard());
			return page;
		}

		const section = E('form', { 'class': 'honk-card' });
		const networkSelect = E('select', { 'class': 'cbi-input-select', 'name': 'lan_network', 'id': 'honk-lan-network' });
		const portInput = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'name': 'listen_port', 'id': 'honk-listen-port', 'min': '1024', 'max': '65535', 'step': '1' });
		const clashEnabledInput = E('input', { 'type': 'checkbox', 'name': 'clash_api_enabled', 'id': 'honk-clash-enabled' });
		const clashSwitch = honk.switchControl(clashEnabledInput);
		const clashPortInput = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'name': 'clash_api_port', 'id': 'honk-clash-port', 'min': '1024', 'max': '65535', 'step': '1' });
		const clashSecretInput = E('input', { 'class': 'cbi-input-password', 'type': 'password', 'name': 'clash_api_secret', 'id': 'honk-clash-secret', 'autocomplete': 'new-password', 'readonly': 'readonly' });
		clashSecretInput.addEventListener('focus', function() { clashSecretInput.removeAttribute('readonly'); });
		const message = E('p', { 'class': 'honk-status-msg', 'role': 'status' }, '');
		const save = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'submit' }, _('Save settings'));
		save.disabled = !!data.statusError;

		(data.networks || []).forEach(function(name) {
			networkSelect.appendChild(E('option', { 'value': name }, name));
		});
		if (data.status && data.status.lan_network && !(data.networks || []).includes(data.status.lan_network))
			networkSelect.appendChild(E('option', { 'value': data.status.lan_network }, data.status.lan_network));
		if (data.status && data.status.lan_network)
			networkSelect.value = data.status.lan_network;
		portInput.value = data.status && data.status.listen_port ? String(data.status.listen_port) : '9527';
		clashEnabledInput.checked = !!(data.status && data.status.clash_api_enabled === true);
		clashSwitch.syncSwitch();
		clashPortInput.value = data.status && data.status.clash_api_port ? String(data.status.clash_api_port) : '9090';

		section.appendChild(E('h3', { 'class': 'honk-card-title' }, _('Honk settings')));

		if (data.statusError)
			section.appendChild(E('div', { 'class': 'alert-message' }, _('Could not read current settings: %s').format(data.statusError)));
		if (data.networkError)
			section.appendChild(E('div', { 'class': 'alert-message' }, _('Could not load LAN networks: %s').format(data.networkError)));
		if (!(data.networks || []).length)
			networkSelect.appendChild(E('option', { 'value': '' }, _('No network interfaces found')));
		section.appendChild(field(_('LAN network'), networkSelect));
		section.appendChild(field(_('Listen port'), portInput));
		section.appendChild(field(_('Enable Clash API'), clashSwitch));
		section.appendChild(field(_('Clash API port'), clashPortInput));
		section.appendChild(field(_('Clash API secret'), clashSecretInput));
		section.appendChild(E('p', { 'class': 'honk-note' }, data.status && data.status.clash_api_secret_set ? _('A secret is set. Leave blank to keep it. Use your existing HTTPS reverse proxy for external access.') : _('A secret is required when enabling Clash API. Use 6–128 letters, numbers, dots, underscores or hyphens.')));
		section.appendChild(E('div', { 'class': 'cbi-page-actions' }, save));
		section.appendChild(message);
		section.addEventListener('submit', function(ev) {
			ev.preventDefault();
			const port = Number(portInput.value);
			const clashPort = Number(clashPortInput.value);
			const clashSecret = clashSecretInput.value;
			if (!networkSelect.value || !Number.isInteger(port) || port < 1024 || port > 65535) {
				message.textContent = _('Choose a LAN network and a port from 1024 to 65535.');
				return;
			}
			if (!Number.isInteger(clashPort) || clashPort < 1024 || clashPort > 65535) {
				message.textContent = _('Clash API port must be between 1024 and 65535.');
				return;
			}
			if (clashEnabledInput.checked && clashPort === port) {
				message.textContent = _('The Clash API port must differ from the listen port.');
				return;
			}
			if (clashEnabledInput.checked && !(data.status && data.status.clash_api_secret_set) && !clashSecret) {
				message.textContent = _('A secret is required when enabling Clash API.');
				return;
			}
			if (clashEnabledInput.checked && clashSecret && !/^[A-Za-z0-9._-]{6,128}$/.test(clashSecret)) {
				message.textContent = _('The secret must be 6-128 letters, numbers, dots, underscores or hyphens.');
				return;
			}

			save.disabled = true;
			message.textContent = _('Saving…');
			honk.settings(networkSelect.value, port, clashEnabledInput.checked, clashPort, clashSecret).then(honk.ensureOk).then(function(result) {
				clashSecretInput.value = '';
				message.textContent = honk.resultMessage(result, _('First setup settings saved.'));
			}).catch(function(error) {
				message.textContent = honk.errorMessage(error, _('Save failed. Check the settings and system status.'));
			}).finally(function() {
				save.disabled = false;
			});
		});

		page.appendChild(E('div', { 'class': 'honk-header' }, [
			E('h2', {}, _('Settings')),
			E('p', { 'class': 'honk-header-sub' }, _('These settings are used only by the first setup wizard. Later changes belong in config.dae.'))
		]));
		page.appendChild(section);

		return page;
	}
});
