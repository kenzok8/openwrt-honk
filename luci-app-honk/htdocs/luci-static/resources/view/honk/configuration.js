// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require view';
'require view.honk.rpc as honk';

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render: function() {
		honk.installStyles();

		const page = E('div', { 'class': 'cbi-map honk-page' });
		page.appendChild(E('div', { 'class': 'honk-header' }, [
			E('h2', {}, _('Configuration')),
			E('p', { 'class': 'honk-header-sub' }, _('Honk reads its nodes, subscriptions and routing from /etc/honk/config.dae.'))
		]));

		const note = E('section', { 'class': 'honk-card' }, [
			E('h3', { 'class': 'honk-card-title' }, _('Direct configuration')),
			E('p', { 'class': 'honk-note' }, _('Add nodes as %s or subscriptions as %s in /etc/honk/config.dae, then reload Honk. The Doona dashboard also manages routing, DNS and subscriptions once Honk is started.').format(
				E('code', {}, "node { label: 'share-link' }"),
				E('code', {}, "subscription { tag: 'url' }")
			))
		]);

		page.appendChild(note);
		return page;
	}
});
