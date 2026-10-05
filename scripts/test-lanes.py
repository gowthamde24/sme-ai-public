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
        return self.run_cmd('./scripts/check-lane-paths.sh', lane, base, ok=ok)

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
        self.check('B', base='missing-base', ok=False)

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


if __name__ == '__main__':
    unittest.main()
