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
		const page = E('div', { 'class': 'cbi-map' });
		const section = E('form', { 'class': 'cbi-section' });
		const networkSelect = E('select', { 'class': 'cbi-input-select', 'name': 'lan_network' });
		const portInput = E('input', { 'class': 'cbi-input-text', 'type': 'number', 'name': 'listen_port', 'min': '1024', 'max': '65535', 'step': '1' });
		const bootEnabledInput = E('input', { 'type': 'checkbox', 'name': 'boot_enabled' });
		const message = E('p', { 'role': 'status' }, '');
		const save = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'submit' }, _('Save settings'));

		(data.networks || []).forEach(function(name) {
			networkSelect.appendChild(E('option', { 'value': name }, name));
		});
		if (data.status && data.status.lan_network && !(data.networks || []).includes(data.status.lan_network))
			networkSelect.appendChild(E('option', { 'value': data.status.lan_network }, data.status.lan_network));
		if (data.status && data.status.lan_network)
			networkSelect.value = data.status.lan_network;
		portInput.value = data.status && data.status.listen_port ? String(data.status.listen_port) : '9527';
		bootEnabledInput.checked = !!(data.status && data.status.boot_enabled === true);

		section.appendChild(E('h3', {}, _('Honk settings')));
		if (data.statusError)
			section.appendChild(E('div', { 'class': 'alert-message' }, _('Could not read current settings: %s').format(data.statusError)));
		if (data.networkError)
			section.appendChild(E('div', { 'class': 'alert-message' }, _('Could not load LAN networks: %s').format(data.networkError)));
		if (!(data.networks || []).length)
			networkSelect.appendChild(E('option', { 'value': '' }, _('No network interfaces found')));
		section.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title', 'for': 'honk-lan-network' }, _('LAN network')),
			E('div', { 'class': 'cbi-value-field' }, networkSelect)
		]));
		networkSelect.id = 'honk-lan-network';
		section.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title', 'for': 'honk-listen-port' }, _('Listen port')),
			E('div', { 'class': 'cbi-value-field' }, portInput)
		]));
		portInput.id = 'honk-listen-port';
		section.appendChild(E('div', { 'class': 'cbi-value' }, [
			E('label', { 'class': 'cbi-value-title', 'for': 'honk-boot-enabled' }, _('Start Honk at boot')),
			E('div', { 'class': 'cbi-value-field' }, bootEnabledInput)
		]));
		bootEnabledInput.id = 'honk-boot-enabled';
		section.appendChild(E('div', { 'class': 'cbi-page-actions' }, save));
		section.appendChild(message);
		section.addEventListener('submit', function(ev) {
			ev.preventDefault();
			const port = Number(portInput.value);
			if (!networkSelect.value || !Number.isInteger(port) || port < 1024 || port > 65535) {
				message.textContent = _('Choose a LAN network and a port from 1024 to 65535.');
				return;
			}

			save.disabled = true;
			message.textContent = _('Saving…');
			honk.settings(networkSelect.value, port, bootEnabledInput.checked).then(honk.ensureOk).then(function(result) {
				message.textContent = honk.resultMessage(result, _('Settings saved and applied.'));
			}).catch(function(error) {
				message.textContent = honk.errorMessage(error, _('Save failed. Check the settings and system status.'));
			}).finally(function() {
				save.disabled = false;
			});
		});

		page.appendChild(E('h2', {}, _('Settings')));
		page.appendChild(section);
		return page;
	}
});
