import { describe, expect, it } from 'vitest';
import { dangerousCommand } from './dangerous-command.js';

describe('dangerousCommand', () => {
  it.each([
    ['rm -rf /', 'recursive delete'],
    ['echo ok | /bin/rm -rf /', 'recursive delete'],
    ['printf safe; sudo -u root /bin/rm -rf /', 'recursive delete'],
    ['env MODE=test /bin/rm -rf /', 'recursive delete'],
    ['command rm -rf /', 'recursive delete'],
    ['echo ok & rm -rf /', 'recursive delete'],
    ['sh -c "rm -rf /"', 'recursive delete'],
    ['bash -lc "rm -rf /"', 'recursive delete'],
    ['eval "rm -rf /"', 'recursive delete'],
    ['printf "$(rm -rf /)"', 'recursive delete'],
    ['printf "`rm -rf /`"', 'recursive delete'],
    ['cat <(rm -rf /)', 'recursive delete'],
    ['printf "$(printf "$(rm -rf /)")"', 'recursive delete'],
    ['printf ok > "/dev/sda"', 'raw-device'],
    ['printf ok 2>>/dev/nvme0n1', 'raw-device'],
    ['printf "DROP TABLE users" | psql', 'destructive SQL'],
    ['echo "TRUNCATE TABLE users" | cat | /usr/bin/psql', 'destructive SQL'],
    ['psql --command="DROP TABLE users"', 'destructive SQL'],
    ['psql -c"DROP TABLE users"', 'destructive SQL'],
    ['psql <<< "DROP TABLE users"', 'destructive SQL'],
    ['mysql -e "DROP DATABASE app"', 'destructive SQL'],
    ['sqlite3 app.db "DROP TABLE users"', 'destructive SQL'],
    ['git push -f | echo --force-with-lease', 'force'],
    ['git -C repo push --force', 'force'],
    ['git rebase -x true main', 'execution'],
    ['git rebase --exec=true main', 'execution'],
    ['git rebase -xtrue main', 'execution'],
    [`rm -rf $${'{'}HOME}`, 'recursive delete'],
    ['rm -rf "$HOME"/""', 'recursive delete'],
    ['sudo -S rm -rf /', 'recursive delete'],
    ['env -S "rm -rf /"', 'recursive delete'],
    ['env --split-string="rm -rf /"', 'recursive delete'],
    ['sudo -s "rm -rf /"', 'recursive delete'],
    ['cat <<EOF\n$(rm -rf /)\nEOF', 'recursive delete'],
    ['printf "$( (printf safe); rm -rf /)"', 'recursive delete'],
    ['printf "rm -rf /" | sh', 'recursive delete'],
    ['sh <<< "rm -rf /"', 'recursive delete'],
    ['psql <<EOF\nDROP TABLE users;\nEOF', 'destructive SQL'],
    ['sh <<EOF\nrm -rf /\nEOF', 'recursive delete'],
    ['echo safe $(rm -rf /)', 'recursive delete'],
    ['echo safe > /dev/sda; printf "rm -rf /"', 'raw-device'],
    ['sudo rm -rf / --no-preserve-root', 'recursive delete'],
    ['rm -Rf $HOME/', 'recursive delete'],
    [':(){ :|:& };:', 'fork bomb'],
    ['dd if=/dev/zero of=/dev/sda', 'raw-device'],
    ['chmod -R 777 ~/', 'permission'],
    ['git push --force origin main', 'force'],
    ['git apply --unsafe-paths x.patch', 'unsafe'],
    ['psql -c "DROP TABLE users"', 'destructive SQL'],
  ])('blocks %s', (command, evidence) => {
    const verdict = dangerousCommand(command);
    expect(verdict.allow).toBe(false);
    expect(verdict.evidence.join(' ')).toContain(evidence);
  });

  it.each([
    'rm -rf ./dist',
    'rm -rf $HOME/projects',
    'git push --force-with-lease origin feature',
    'git commit -m "document --exec"',
    'pnpm test',
    'rg "rm -rf /; DROP TABLE users | mkfs.ext4" docs',
    "grep 'sudo rm -rf / && git push --force' README.md",
    "echo 'DROP TABLE users; TRUNCATE TABLE users'",
    "printf '%s' 'rm -rf / | mkfs.ext4 /dev/sda'",
    "printf '%s' '$(rm -rf /)'",
    "echo '`rm -rf /`'",
    "echo ':(){ :|:& };:'",
    'echo "dd of=/dev/sda > /dev/sda"',
    'git rebase --rebase-merges main',
    'git rebase --strategy-option=theirs main',
    'git cherry-pick --strategy-option theirs abc123',
    'git rebase --onto topic--exec main',
    'git apply --include=--unsafe-paths patch',
    'sh -c "printf safe" "rm -rf /"',
    'echo rm -rf /',
    'printf "DROP TABLE users"; psql -c "SELECT 1"',
    "cat <<'EOF'\nrm -rf /\nDROP TABLE users;\nEOF",
    'psql -d "DROP TABLE users" -c "SELECT 1"',
    'echo "\\$(rm -rf /)"',
    'echo "\\`rm -rf /\\`"',
    'printf "$(echo safe)"',
    'echo safe # rm -rf /',
    'cat <<EOF\n$HOME\nEOF',
    "cat <<'EOF'\n$(rm -rf /)\nEOF",
    'git rebase --strategy-option --exec main',
    'git apply --include --unsafe-paths patch',
    'sudo printf "%s" "-s" "rm -rf /"',
    'env printf "%s" "-S" "rm -rf /"',
    "printf \"$( (printf safe); printf 'rm -rf /')\"",
  ])('allows %s', (command) => {
    expect(dangerousCommand(command).allow).toBe(true);
  });

  it.each([
    "sh -c $'rm -rf /'",
    '"$EXECUTABLE" -rf /',
    'printf "unterminated',
    "cat <<'EOF' | sh\nrm -rf /\nEOF",
  ])('refuses unsupported executable syntax explicitly: %s', (command) => {
    const verdict = dangerousCommand(command);
    expect(verdict.allow).toBe(false);
    expect(verdict.evidence.join(' ')).toContain('unsupported');
  });

  it('bounds recursively executable shell strings', () => {
    let command = 'true';
    for (let depth = 0; depth < 10; depth += 1) {
      command = `sh -c '${command.replaceAll("'", "'\\''")}'`;
    }
    expect(dangerousCommand(command).evidence).toEqual(['shell inspection nesting limit']);
  });
});
