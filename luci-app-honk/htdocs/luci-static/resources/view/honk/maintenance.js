// SPDX-License-Identifier: GPL-3.0-only

'use strict';
'require fs';
'require ui';
'require view';
'require view.honk.rpc as honk';

const BACKUP_PATH = '/tmp/honk-backup.tar.gz';
const RESTORE_PATH = '/tmp/honk-maintenance/restore.tar.gz';

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render: function() {
		const page = E('div', { 'class': 'cbi-map' });
		const health = E('div', { 'class': 'cbi-section' }, [ E('h3', {}, _('System check')) ]);
		const healthMessage = E('p', { 'role': 'status' }, '');
		const writeControls = [];
		let recoveryRequired = false;
		function phaseMessage(job, fallback) {
			const messages = {
				checking_feed: _('Checking the signed update source…'),
				downloading: _('Downloading the signed package set…'),
				preparing: _('Preparing maintenance…'),
				stopping: _('Stopping Honk…'),
				applying: _('Applying the staged data…'),
				validating: _('Validating the new state…'),
				starting: _('Starting Honk…'),
				rolling_back: _('Restoring the previous state…'),
				committing: _('Finishing the transaction…'),
				recovery: _('Recovery is required before another write operation.')
			};
			return messages[job.phase] || fallback;
		}
		function blockWrites() {
			recoveryRequired = true;
			writeControls.forEach(function(button) { button.disabled = true; });
		}
		const check = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Run system check'));
		check.addEventListener('click', function(ev) {
			ev.preventDefault();
			check.disabled = true;
			healthMessage.textContent = _('Checking…');
			honk.check().then(function(result) {
				if (result && result.ok === true) {
					healthMessage.textContent = _('System check passed.');
				}
				else if (Array.isArray(result && result.errors) && result.errors.length) {
					healthMessage.textContent = result.errors.map(honk.statusIssue).join('；');
				}
				else {
					healthMessage.textContent = _('The backend did not confirm the check.');
				}
			}).catch(function(error) {
				healthMessage.textContent = _('System check failed.');
			}).finally(function() { check.disabled = false; });
		});
		health.appendChild(E('p', {}, _('Checks Honk system components and reports detected issues.')));
		health.appendChild(check);
		health.appendChild(healthMessage);

		const repairSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Repair system files')),
			E('p', {}, _('Repair replaces missing or damaged Honk system files and does not overwrite user configuration.'))
		]);
		const repairMessage = E('p', { 'role': 'status' }, '');
		const repair = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Repair'));
		writeControls.push(repair);
		repair.addEventListener('click', function(ev) {
			ev.preventDefault();
			repair.disabled = true;
			repairMessage.textContent = _('Repairing…');
			honk.repair().then(honk.ensureOk).then(function(result) {
				repairMessage.textContent = honk.resultMessage(result, _('Repair completed.'));
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				repairMessage.textContent = honk.errorMessage(error, _('Repair failed.'));
			}).finally(function() { repair.disabled = recoveryRequired; });
		});
		repairSection.appendChild(repair);
		repairSection.appendChild(repairMessage);

		const backupSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Backup and restore')),
			E('p', {}, _('Create a backup archive or restore one from your computer.'))
		]);
		const backupMessage = E('p', { 'role': 'status' }, '');
		const backup = E('button', { 'class': 'cbi-button cbi-button-action' }, _('Download backup'));
		writeControls.push(backup);
		backup.addEventListener('click', function(ev) {
			ev.preventDefault();
			backup.disabled = true;
			backupMessage.textContent = _('Preparing backup…');
			honk.backup().then(honk.ensureOk).then(function(result) {
				return honk.waitJob(result.job_id, function(job) {
					backupMessage.textContent = job.state === 'running' ? _('Creating backup…') : _('Preparing download…');
				});
			}).then(function() {
				return fs.read_direct(BACKUP_PATH, 'blob');
			}).then(function(blob) {
				const url = URL.createObjectURL(blob);
				const link = E('a', { 'href': url, 'download': 'honk-backup.tar.gz' });
				document.body.appendChild(link);
				link.click();
				link.remove();
				setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
				backupMessage.textContent = _('Backup downloaded.');
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				backupMessage.textContent = honk.errorMessage(error, _('Backup failed.'));
			}).finally(function() { backup.disabled = recoveryRequired; });
		});
		const restore = E('button', { 'class': 'cbi-button cbi-button-negative' }, _('Restore backup'));
		writeControls.push(restore);
		restore.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!confirm(_('Stop Honk before restoring. Restoring replaces Honk user data. Continue?')))
				return;

			restore.disabled = true;
			backupMessage.textContent = _('Choose a backup archive to upload…');
			honk.restorePrepare().then(honk.ensureOk).then(function() {
				return ui.uploadFile(RESTORE_PATH);
			}).then(function() {
				backupMessage.textContent = _('Restoring…');
				return honk.restore();
			}).then(honk.ensureOk).then(function(result) {
				return honk.waitJob(result.job_id, function(job) {
					backupMessage.textContent = phaseMessage(job, _('Restoring Honk data…'));
				});
			}).then(function(result) {
				backupMessage.textContent = honk.resultMessage(result, _('Backup restored.'));
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				backupMessage.textContent = honk.errorMessage(error, _('Restore failed.'));
			}).finally(function() { restore.disabled = recoveryRequired; });
		});
		backupSection.appendChild(E('div', { 'class': 'cbi-page-actions' }, [ backup, restore ]));
		backupSection.appendChild(backupMessage);

		const resetSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Reset Honk data')),
			E('p', {}, _('Reset clears Honk subscriptions, nodes, policies, DNS data, history, and cache, then restores default configuration. It keeps the administrator account and leaves Honk stopped with boot disabled.'))
		]);
		const resetMessage = E('p', { 'role': 'status' }, '');
		const reset = E('button', { 'class': 'cbi-button cbi-button-negative', 'type': 'button' }, _('Reset Honk data'));
		writeControls.push(reset);
		reset.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!confirm(_('This permanently clears Honk subscriptions, nodes, policies, DNS data, history, and cache. The administrator account is kept, and Honk will be stopped. Continue?')))
				return;

			reset.disabled = true;
			resetMessage.textContent = _('Resetting Honk data…');
			honk.reset().then(honk.ensureOk).then(function(result) {
				return honk.waitJob(result.job_id, function(job) {
					resetMessage.textContent = phaseMessage(job, _('Resetting Honk data…'));
				});
			}).then(function(result) {
				resetMessage.textContent = honk.resultMessage(result, _('Honk data reset. The service is stopped.'));
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				resetMessage.textContent = honk.errorMessage(error, _('Reset failed.'));
			}).finally(function() { reset.disabled = recoveryRequired; });
		});
		resetSection.appendChild(reset);
		resetSection.appendChild(resetMessage);

		const updateSection = E('div', { 'class': 'cbi-section' }, [
			E('h3', {}, _('Honk updates')),
			E('p', {}, _('Updates install the matching Honk core, LuCI, Doona assets, and Chinese translation as one package set.')),
			E('p', {}, _('This target supports x86_64 on OpenWrt 25.12 using APK packages.')),
			E('p', {}, _('The updater verifies a signed compatibility manifest. Installation stays disabled until a complete verified rollback package set is available and the device transaction path has passed validation.'))
		]);
		const updateMessage = E('p', { 'role': 'status' }, '');
		const updateCheck = E('button', { 'class': 'cbi-button cbi-button-action', 'type': 'button' }, _('Check for updates'));
		const updateApply = E('button', { 'class': 'cbi-button cbi-button-positive', 'type': 'button' }, _('Install update'));
		updateApply.disabled = true;
		updateApply.style.display = 'none';
		writeControls.push(updateApply);
		updateCheck.addEventListener('click', function(ev) {
			ev.preventDefault();
			updateCheck.disabled = true;
			updateApply.disabled = true;
			updateApply.style.display = 'none';
			updateMessage.textContent = _('Checking update source…');
			honk.updateCheck().then(honk.ensureOk).then(function(job) {
				return honk.waitJob(job.job_id, function(progress) {
					updateMessage.textContent = phaseMessage(progress, _('Checking the signed update source…'));
				});
			}).then(function(result) {
				if (result.available) {
					updateMessage.textContent = result.apply_enabled === true ? _('A compatible update is available: %s').format(result.version || '') : honk.statusIssue(result.reason);
					updateApply.disabled = result.apply_enabled !== true;
					updateApply.style.display = result.apply_enabled === true ? '' : 'none';
				} else {
					updateMessage.textContent = result.reason === 'trusted_feed_unavailable' ? _('No trusted update source is configured.') : _('No compatible update is available.');
				}
			}).catch(function(error) {
				updateMessage.textContent = honk.errorMessage(error, _('Update check failed.'));
			}).finally(function() { updateCheck.disabled = recoveryRequired; });
		});
		updateApply.addEventListener('click', function(ev) {
			ev.preventDefault();
			if (!confirm(_('Install the verified Honk, LuCI, Doona, and Chinese translation package set? If installation or startup fails, Honk will remain stopped and show recovery instructions.')))
				return;
			updateCheck.disabled = true;
			updateApply.disabled = true;
			updateMessage.textContent = _('Preparing the signed update…');
			honk.updateApply().then(honk.ensureOk).then(function(result) {
				return honk.waitJob(result.job_id, function(job) {
					updateMessage.textContent = phaseMessage(job, _('Installing the verified update…'));
				});
			}).then(function(result) {
				updateMessage.textContent = honk.resultMessage(result, _('Update installed.'));
			}).catch(function(error) {
				if (error && error.recoveryRequired)
					blockWrites();
				updateMessage.textContent = honk.errorMessage(error, _('Update failed.'));
			}).finally(function() {
				updateCheck.disabled = recoveryRequired;
				updateApply.disabled = true;
				updateApply.style.display = 'none';
			});
		});
		updateSection.appendChild(updateCheck);
		updateSection.appendChild(updateApply);
		updateSection.appendChild(updateMessage);

		page.appendChild(E('h2', {}, _('Maintenance')));
		page.appendChild(health);
		page.appendChild(repairSection);
		page.appendChild(backupSection);
		page.appendChild(resetSection);
		page.appendChild(updateSection);
		honk.status().then(function(result) {
			if (Array.isArray(result && result.errors) && result.errors.indexOf('maintenance_recovery_required') >= 0) {
				blockWrites();
				healthMessage.textContent = _('A previous maintenance operation needs recovery before write operations can continue.');
			}
		}).catch(function() {});
		return page;
	}
});
