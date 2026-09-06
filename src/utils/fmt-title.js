
	function truncate(text, max) {
		var s = String(text == null ? '' : text);
		if (s.length <= max) return s;
		/* cut at a word boundary when possible, never mid-word */
		var cut = s.slice(0, max - 1);
		var space = cut.lastIndexOf(' ');
		if (space > max * 0.5) cut = cut.slice(0, space);
		return cut + '…';
	}

	/** git subcommand -> short Chinese verb. */
	var GIT_VERBS = {
		push: '推送',
		pull: '拉取',
		clone: '克隆',
		commit: '提交',
		status: '状态',
		log: '日志',
		add: '暂存',
		checkout: '切换',
		merge: '合并',
		stash: '暂存',
		fetch: '拉取',
		diff: '差异',
		branch: '分支',
		remote: '远程',
		tag: '标签',
		reset: '重置',
		rebase: '变基'
	};

	/** Common shell commands -> brief semantic titles (first match wins). */
	var COMMAND_TITLES = [
		{ re: /^Start-Sleep\s+-Seconds\s+(\d+)/i, title: function (m) { return '等待 ' + m[1] + ' 秒'; } },
		{ re: /^Start-Sleep\s+-Milliseconds\s+(\d+)/i, title: function (m) { return '等待 ' + m[1] + ' 毫秒'; } },
		{ re: /^git\s+(\S+)/i, title: function (m) { return 'Git ' + (GIT_VERBS[m[1].toLowerCase()] || m[1]); } },
		{ re: /^(npm|pnpm|yarn|bun)\s+(install|i)\b/i, title: '安装依赖' },
		{ re: /^(npm|pnpm|yarn|bun)\s+run\s+(\S+)/i, title: function (m) { return '运行脚本 ' + m[2]; } },
		{ re: /^(npm|pnpm|yarn|bun)\s+build\b/i, title: '构建项目' },
		{ re: /^node\s+/i, title: '运行 Node 脚本' },
		{ re: /^python3?\s+/i, title: '运行 Python 脚本' },
		{ re: /^pip3?\s+install\b/i, title: '安装 Python 包' },
		{ re: /^(cd|Set-Location)\b/i, title: '切换目录' },
		{ re: /^(ls|dir|Get-ChildItem)\b/i, title: '查看目录' },
		{ re: /^(echo|Write-Output)\b/i, title: '输出文本' },
		{ re: /^Start-Process\b/i, title: '启动进程' },
		{ re: /^(Invoke-WebRequest|curl)\b/i, title: '网络请求' }
	];

	/**
	 * Derive a short, human-friendly task title from a raw job label.
	 * - non-shell jobs (subagent, …) keep their description verbatim
	 * - shell jobs get a semantic title from COMMAND_TITLES, falling back to
	 *   the first statement (word-boundary truncated) of the cleaned command
	 */
	function taskTitle(job) {
		var label = String(job.label == null ? '' : job.label).trim();
		label = label.replace(/^\[Console\]::OutputEncoding[\s\S]*?\$OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\);\s*/i, '');
		var quoted = label.match(/^(['"])([\s\S]*)\1$/);
		if (quoted) label = quoted[2].trim();
		var kind = job.kind;
		if (kind === 'bash' || kind === 'pwsh' || kind === 'pty-send') {
			var first = label.split(';')[0].trim();
			for (var i = 0; i < COMMAND_TITLES.length; i++) {
				var m = first.match(COMMAND_TITLES[i].re);
				if (m) {
					var t = COMMAND_TITLES[i].title;
					return typeof t === 'function' ? t(m) : t;
				}
			}
			return truncate(first, 20);
		}
		return label;
	}

