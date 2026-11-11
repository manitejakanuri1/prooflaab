/**
 * Language choice on "read input, print output" Lots (migration 226). The server decides which Lots get the
 * menu (sandbox_task_view `languages`) and refuses any other language; this file only names them, gives each
 * a fixed starter (no AI) and words the question for any language.
 */
export const LANGUAGE_LABEL: Record<string, string> = {
  python: "Python", java: "Java", c: "C", cpp: "C++", javascript: "JavaScript",
};

export const languageLabel = (id: string | null | undefined) => (id ? LANGUAGE_LABEL[id] ?? id : "");

/** Each starter reads all of stdin and prints one answer. */
export const STARTERS: Record<string, string> = {
  python: `import sys

lines = sys.stdin.read().splitlines()
# lines[0] is the first line of input

answer = ""
print(answer)
`,
  java: `import java.io.*;
import java.util.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        List<String> lines = new ArrayList<>();
        for (String line; (line = in.readLine()) != null; ) lines.add(line);
        // lines.get(0) is the first line of input

        String answer = "";
        System.out.println(answer);
    }
}
`,
  c: `#include <stdio.h>
#include <string.h>

int main(void) {
    char line[100000];
    while (fgets(line, sizeof line, stdin)) {
        line[strcspn(line, "\\n")] = '\\0';
        /* line is one line of input */
    }

    printf("%s\\n", "");
    return 0;
}
`,
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    vector<string> lines;
    for (string line; getline(cin, line); ) lines.push_back(line);
    // lines[0] is the first line of input

    string answer = "";
    cout << answer << endl;
    return 0;
}
`,
  javascript: `const lines = require("fs").readFileSync(0, "utf8").split("\\n");
// lines[0] is the first line of input

const answer = "";
console.log(answer);
`,
};

const NAMED = /\b(?:an?|the|your)\s+(?:Python|Java|JavaScript|JS|C\+\+|C)\s+(?:function|program|script|class|method|solution|code|snippet)\b/gi;

/** Screen-only wording for a Lot open to any language: "Write a JavaScript function" -> "Write your code". */
export const anyLanguageText = (s: string) => s.replace(NAMED, "your code");
