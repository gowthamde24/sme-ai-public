"""Smoke tests for lane plumbing; stdlib only, all mutations in temporary repos."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1]


class LaneTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name) / 'repo'
        self.repo.mkdir()
        self.env = dict(os.environ, GIT_CONFIG_NOSYSTEM='1',
                        GIT_CONFIG_GLOBAL=os.devnull)
        self.run_cmd('git', 'init', '-b', 'main')
        self.run_cmd('git', 'config', 'user.name', 'Lane Test')
        self.run_cmd('git', 'config', 'user.email', 'lane@example.invalid')
        (self.repo / 'scripts').mkdir()
        for name in ('new-lane.sh', 'check-lane-paths.sh'):
            shutil.copy2(SOURCE / 'scripts' / name, self.repo / 'scripts' / name)
        shutil.copy2(SOURCE / 'lanes.json', self.repo / 'lanes.json')
        self.write('README.md', 'fixture\n')
        self.commit()

    def run_cmd(self, *args, ok=True):
        result = subprocess.run(args, cwd=self.repo, env=self.env,
                                capture_output=True, text=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def write(self, name, content='fixture\n'):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def commit(self):
        self.run_cmd('git', 'add', '.')
        self.run_cmd('git', 'commit', '-m', 'Setup: fixture')

    def check(self, lane, ok=True, base='main'):
        # Same trust boundary as CI: execute the BASE version, never PR head.
        trusted = self.repo.parent / 'trusted-guard.sh'
        trusted.write_text(self.run_cmd('git', 'show',
                                       base + ':scripts/check-lane-paths.sh').stdout)
        return self.run_cmd('env', 'LANE_POLICY_FROM_BASE=1', 'bash', str(trusted),
                            lane, base, ok=ok)


    def test_new_lane_from_main_and_refusals(self):
        self.run_cmd('git', 'switch', '-c', 'lane/setup')
        self.write('only-on-setup.md')
        self.commit()
        main = self.run_cmd('git', 'rev-parse', 'main').stdout.strip()
        self.run_cmd('./scripts/new-lane.sh', 'b')
        target = self.repo.parent / 'sme-ai-b'
        self.assertEqual(self.run_cmd('git', '-C', str(target), 'rev-parse', 'HEAD').stdout.strip(), main)
        self.assertEqual(self.run_cmd('git', '-C', str(target), 'branch', '--show-current').stdout.strip(), 'lane/b')
        self.run_cmd('./scripts/new-lane.sh', 'b', ok=False)
        self.run_cmd('./scripts/new-lane.sh', '../bad', ok=False)
        self.write('dirty.txt')
        self.run_cmd('./scripts/new-lane.sh', 'c', ok=False)
        self.assertFalse((self.repo.parent / 'sme-ai-c').exists())

    def test_new_lane_existing_directory_branch_and_missing_main(self):
        (self.repo.parent / 'sme-ai-a').mkdir()
        self.run_cmd('./scripts/new-lane.sh', 'a', ok=False)
        self.run_cmd('git', 'branch', 'lane/c')
        self.run_cmd('./scripts/new-lane.sh', 'c', ok=False)
        self.run_cmd('git', 'branch', '-m', 'trunk')
        self.run_cmd('./scripts/new-lane.sh', 'b', ok=False)

    def test_allowed_paths_each_lane(self):
        examples = {'A': 'supabase/migrations/example.sql',
                    'B': 'apps/web/app/app/tenants/[tenantId]/review/factor-breakdown.tsx',
                    'C': 'packages/quote-engine/test_quote.py',
                    'setup': 'docs/lanes.md'}
        for lane, path in examples.items():
            with self.subTest(lane=lane):
                self.run_cmd('git', 'switch', '-c', 'example-' + lane, 'main')
                self.write(path)
                self.commit()
                self.check(lane)
                if lane in 'ABC':
                    self.check(lane.lower())

    def test_disallowed_security_unknown_lane_and_base(self):
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        self.write('apps/web/app/login/actions.ts')
        self.commit()
        self.check('B', ok=False)
        self.check('C', ok=False)
        self.check('unknown', ok=False)
        self.run_cmd('./scripts/check-lane-paths.sh', 'B', 'missing-base', ok=False)

    def test_deny_wins(self):
        policy = json.loads((self.repo / 'lanes.json').read_text())
        policy['lanes']['B']['deny'].append('apps/web/components/ui/private/*')
        (self.repo / 'lanes.json').write_text(json.dumps(policy))
        self.commit()
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        self.write('apps/web/components/ui/private/card.tsx')
        self.commit()
        self.check('B', ok=False)

    def test_rename_and_deletion_check_both_paths(self):
        self.write('services/ai-api/old.py')
        self.commit()
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        (self.repo / 'apps/web/components/ui').mkdir(parents=True)
        self.run_cmd('git', 'mv', 'services/ai-api/old.py', 'apps/web/components/ui/card.tsx')
        self.commit()
        self.check('B', ok=False)
        self.run_cmd('git', 'switch', '-c', 'deletion', 'main')
        self.run_cmd('git', 'rm', 'services/ai-api/old.py')
        self.commit()
        self.check('B', ok=False)

    def test_merge_base_ignores_later_main_changes_and_odd_names(self):
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        self.write('apps/web/components/ui/space\nname.tsx')
        self.commit()
        self.run_cmd('git', 'switch', 'main')
        self.write('services/ai-api/main-only.py')
        self.commit()
        self.run_cmd('git', 'switch', 'lane/b')
        self.check('B')
        self.write('not allowed\nfile.txt')
        self.commit()
        self.check('B', ok=False)

    def test_head_policy_cannot_widen_lane(self):
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        policy = json.loads((self.repo / 'lanes.json').read_text())
        policy['lanes']['B']['allow'] = ['*']
        policy['lanes']['B']['deny'] = []
        self.write('lanes.json', json.dumps(policy))
        self.write('services/ai-api/forbidden.py')
        self.commit()
        result = self.check('B', ok=False)
        self.assertIn("Outside lane B: 'services/ai-api/forbidden.py'", result.stderr)
        # The unedited local checker also loads policy from the merge-base.
        self.run_cmd('./scripts/check-lane-paths.sh', 'B', ok=False)

    def test_ci_uses_target_base_policy_and_local_uses_merge_base(self):
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        self.write('apps/web/components/ui/card.tsx')
        self.commit()
        self.run_cmd('git', 'switch', 'main')
        policy = json.loads((self.repo / 'lanes.json').read_text())
        policy['lanes']['B']['deny'].append('apps/web/components/ui/*')
        self.write('lanes.json', json.dumps(policy))
        self.commit()
        self.run_cmd('git', 'switch', 'lane/b')
        self.check('B', ok=False)
        self.run_cmd('./scripts/check-lane-paths.sh', 'B')

    def test_head_script_cannot_bypass_trusted_guard(self):
        self.run_cmd('git', 'switch', '-c', 'lane/c')
        self.write('scripts/check-lane-paths.sh', '#!/bin/sh\nexit 0\n')
        self.commit()
        result = self.check('C', ok=False)
        self.assertIn("Outside lane C: 'scripts/check-lane-paths.sh'", result.stderr)

    def test_bootstrap_policy_missing_fails_closed(self):
        self.run_cmd('git', 'rm', 'lanes.json')
        self.commit()
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        self.write('apps/web/components/ui/card.tsx')
        self.commit()
        result = self.check('B', ok=False)
        self.assertIn('owner must bootstrap locally', result.stderr)

    def test_a_general_paths_and_protected_policy(self):
        self.run_cmd('git', 'switch', '-c', 'lane/a')
        for path in ('Makefile', 'deploy/config.toml', 'docs/plans/example.md',
                     'root-config.json', 'scripts/ordinary.py', '.github/workflows/ci.yml',
                     'docs/adr/0018-example.md'):
            self.write(path)
        self.commit()
        self.check('A')
        policy = (self.repo / 'lanes.json').read_text()
        self.write('lanes.json', policy + '\n')
        self.commit()
        self.check('A', ok=False)

    def test_a_exclusive_paths_refused(self):
        examples = ('apps/web/components/ui/card.tsx',
                    'packages/quote-engine/quote.py', 'docs/adr/0040-ui.md',
                    '.github/workflows/lane-paths.yml')
        for index, path in enumerate(examples):
            with self.subTest(path=path):
                self.run_cmd('git', 'switch', '-c', f'exclusive-{index}', 'main')
                self.write(path)
                self.commit()
                self.check('A', ok=False)

    def test_symlink_refused(self):
        for lane, path in (('B', 'apps/web/components/ui/link'),
                           ('C', 'packages/pure/link')):
            with self.subTest(lane=lane):
                self.run_cmd('git', 'switch', '-c', 'link-' + lane, 'main')
                target = self.repo / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.symlink_to('../../README.md')
                self.commit()
                result = self.check(lane, ok=False)
                self.assertIn('Symlink or submodule refused', result.stderr)

    def test_submodule_refused(self):
        for lane, path in (('B', 'apps/web/components/ui/vendor'),
                           ('C', 'packages/pure/vendor')):
            with self.subTest(lane=lane):
                self.run_cmd('git', 'switch', '-c', 'submodule-' + lane, 'main')
                sha = self.run_cmd('git', 'rev-parse', 'HEAD').stdout.strip()
                self.run_cmd('git', 'update-index', '--add', '--cacheinfo',
                             '160000,' + sha + ',' + path)
                self.run_cmd('git', 'commit', '-m', 'Setup: fixture gitlink')
                result = self.check(lane, ok=False)
                self.assertIn('Symlink or submodule refused', result.stderr)

    def test_file_mode_change_refused(self):
        self.write('apps/web/components/ui/card.py')
        self.commit()
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        self.run_cmd('git', 'update-index', '--chmod=+x', 'apps/web/components/ui/card.py')
        self.run_cmd('git', 'commit', '-m', 'Setup: fixture mode')
        result = self.check('B', ok=False)
        self.assertIn('File-mode change refused', result.stderr)

    def test_new_executable_refused(self):
        self.run_cmd('git', 'switch', '-c', 'lane/c')
        self.write('packages/pure/execute.py')
        self.run_cmd('git', 'add', '.')
        self.run_cmd('git', 'update-index', '--chmod=+x', 'packages/pure/execute.py')
        self.run_cmd('git', 'commit', '-m', 'Setup: executable fixture')
        result = self.check('C', ok=False)
        self.assertIn('New executable refused', result.stderr)

    def test_gitmodules_refused(self):
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        self.write('.gitmodules', '# fixture\n')
        self.commit()
        result = self.check('B', ok=False)
        self.assertIn('Forbidden Git control path', result.stderr)

    def test_gitattributes_refused(self):
        self.run_cmd('git', 'switch', '-c', 'lane/c')
        self.write('packages/pure/.gitattributes', '*.py text\n')
        self.commit()
        result = self.check('C', ok=False)
        self.assertIn('Forbidden Git control path', result.stderr)

    def test_git_hooks_refused(self):
        self.run_cmd('git', 'switch', '-c', 'lane/b')
        self.write('apps/web/components/ui/.githooks/pre-commit')
        self.commit()
        result = self.check('B', ok=False)
        self.assertIn('Forbidden Git control path', result.stderr)

    def test_package_target_discovers_all_packages_and_propagates_failure(self):
        shutil.copy2(SOURCE / 'Makefile', self.repo / 'Makefile')
        shutil.copy2(SOURCE / 'scripts/test-packages.py', self.repo / 'scripts/test-packages.py')
        for package in ('example', 'second'):
            self.write(f'packages/{package}/tests/test_example.py',
                       'import unittest\nclass Example(unittest.TestCase):\n'
                       '    def test_example(self):\n        self.assertEqual(2 + 2, 4)\n')
        result = self.run_cmd('make', 'test-packages')
        self.assertIn('example/tests', result.stdout)
        self.assertIn('second/tests', result.stdout)
        self.assertEqual(result.stderr.count('test_example (test_example.Example.test_example)'), 2)
        self.write('packages/example/tests/test_example.py',
                   'import unittest\nclass Example(unittest.TestCase):\n'
                   '    def test_example(self):\n        self.fail("fixture failure")\n')
        self.run_cmd('make', 'test-packages', ok=False)

    def test_package_runner_blocks_network(self):
        shutil.copy2(SOURCE / 'Makefile', self.repo / 'Makefile')
        shutil.copy2(SOURCE / 'scripts/test-packages.py', self.repo / 'scripts/test-packages.py')
        self.write('packages/example/test_network.py',
                   'import socket, unittest\nclass Example(unittest.TestCase):\n'
                   '    def test_network(self):\n'
                   '        with self.assertRaises(RuntimeError): socket.socket()\n')
        self.run_cmd('make', 'test-packages')


if __name__ == '__main__':
    unittest.main()
