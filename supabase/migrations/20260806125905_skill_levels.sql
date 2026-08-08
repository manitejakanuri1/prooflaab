-- Skill levels: an ordered, dependency-aware path per track.
CREATE TABLE public.level_tracks (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  interest    TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL,
  emoji       TEXT NOT NULL DEFAULT '🎯',
  sort_order  INT  NOT NULL DEFAULT 0
);

CREATE TABLE public.levels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  track_slug   TEXT NOT NULL REFERENCES public.level_tracks(slug) ON DELETE CASCADE,
  level_number INT  NOT NULL,
  skill        TEXT NOT NULL,
  title        TEXT NOT NULL,
  UNIQUE (track_slug, level_number)
);

CREATE INDEX idx_levels_track ON public.levels(track_slug, level_number);

CREATE TABLE public.level_content (
  level_id     UUID PRIMARY KEY REFERENCES public.levels(id) ON DELETE CASCADE,
  explanation  TEXT NOT NULL,
  quiz         JSONB NOT NULL,
  proof_title  TEXT NOT NULL,
  proof_brief  TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.student_tracks (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id        UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  track_slug        TEXT NOT NULL REFERENCES public.level_tracks(slug) ON DELETE CASCADE,
  placed_at_level   INT  NOT NULL DEFAULT 1,
  unlocked_through  INT  NOT NULL DEFAULT 1,
  is_primary        BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, track_slug)
);

CREATE TABLE public.student_levels (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id   UUID NOT NULL REFERENCES public.student_profiles(id) ON DELETE CASCADE,
  level_id     UUID NOT NULL REFERENCES public.levels(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'opened'
               CHECK (status IN ('placed', 'opened', 'cleared', 'mastered')),
  best_score   INT  NOT NULL DEFAULT 0,
  attempts     INT  NOT NULL DEFAULT 0,
  task_id      UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  cleared_at   TIMESTAMPTZ,
  mastered_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (student_id, level_id)
);

CREATE INDEX idx_student_levels_student ON public.student_levels(student_id);

ALTER TABLE public.tasks
  ADD COLUMN level_id UUID REFERENCES public.levels(id) ON DELETE SET NULL;

CREATE INDEX idx_tasks_level ON public.tasks(level_id) WHERE level_id IS NOT NULL;

ALTER TABLE public.level_tracks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.levels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.level_content  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_levels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone signed in can read tracks"
  ON public.level_tracks FOR SELECT TO authenticated USING (true);

CREATE POLICY "Anyone signed in can read levels"
  ON public.levels FOR SELECT TO authenticated USING (true);

CREATE POLICY "Students read their own track progress"
  ON public.student_tracks FOR SELECT TO authenticated
  USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

CREATE POLICY "Students read their own level progress"
  ON public.student_levels FOR SELECT TO authenticated
  USING (student_id IN (SELECT id FROM public.student_profiles WHERE user_id = auth.uid()));

REVOKE INSERT, UPDATE, DELETE ON public.level_tracks   FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.levels         FROM anon, authenticated;
REVOKE ALL                    ON public.level_content  FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_tracks FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.student_levels FROM anon, authenticated;

INSERT INTO public.level_tracks (slug, name, interest, role, emoji, sort_order) VALUES
  ('web-development',    'Web Development',    'Web Development',    'Web Developer',            '🌐', 1),
  ('mobile-development', 'Mobile Development', 'Mobile Development', 'Mobile App Developer',     '📱', 2),
  ('data-science',       'Data Science',       'Data Science',       'Data Analyst',             '📊', 3),
  ('machine-learning',   'Machine Learning',   'Machine Learning',   'Machine Learning Engineer','🤖', 4),
  ('cloud-computing',    'Cloud Computing',    'Cloud Computing',    'Cloud Engineer',           '☁️', 5),
  ('devops',             'DevOps',             'DevOps',             'DevOps Engineer',          '🔧', 6),
  ('cybersecurity',      'Cybersecurity',      'Cybersecurity',      'Security Analyst',         '🛡️', 7),
  ('ui-ux-design',       'UI/UX Design',       'UI/UX Design',       'UI/UX Designer',           '🎨', 8),
  ('game-development',   'Game Development',   'Game Development',   'Game Developer',           '🎮', 9),
  ('blockchain',         'Blockchain',         'Blockchain',         'Blockchain Developer',     '⛓️', 10),
  ('iot',                'IoT',                'IoT',                'IoT Engineer',             '📡', 11),
  ('robotics',           'Robotics',           'Robotics',           'Robotics Engineer',        '🦾', 12);

INSERT INTO public.levels (track_slug, level_number, skill, title) VALUES
  ('web-development',  1, 'Git & GitHub',   'Stop losing your work'),
  ('web-development',  2, 'HTML/CSS',       'Boxes on a page'),
  ('web-development',  3, 'JavaScript',     'Making the page do things'),
  ('web-development',  4, 'REST APIs',      'Talking to somebody else''s server'),
  ('web-development',  5, 'React',          'Components instead of spaghetti'),
  ('web-development',  6, 'Tailwind',       'CSS without the crying'),
  ('web-development',  7, 'TypeScript',     'Catching bugs before they hatch'),
  ('web-development',  8, 'Node.js',        'JavaScript leaves the browser'),
  ('web-development',  9, 'Express',        'Your first real backend'),
  ('web-development', 10, 'SQL',            'Asking the database nicely'),
  ('web-development', 11, 'PostgreSQL',     'A database that fights back'),
  ('web-development', 12, 'JWT Auth',       'Proving who you are'),
  ('web-development', 13, 'MongoDB',        'Data without the straitjacket'),
  ('web-development', 14, 'Next.js',        'React with a grown-up plan'),
  ('web-development', 15, 'Vercel',         'Ship it to the internet'),
  ('web-development', 16, 'DSA',            'The interview boss fight'),

  ('mobile-development',  1, 'Git & GitHub',          'Stop losing your work'),
  ('mobile-development',  2, 'Java',                  'The language Android grew up on'),
  ('mobile-development',  3, 'Kotlin',                'Java, but it likes you'),
  ('mobile-development',  4, 'JSON',                  'How apps pass notes'),
  ('mobile-development',  5, 'REST APIs',             'Getting data from the internet'),
  ('mobile-development',  6, 'Jetpack Compose',       'Screens you describe, not draw'),
  ('mobile-development',  7, 'SQLite',                'A database in your pocket'),
  ('mobile-development',  8, 'Room',                  'SQLite without the boilerplate'),
  ('mobile-development',  9, 'Firebase',              'A backend you did not have to build'),
  ('mobile-development', 10, 'Dart',                  'Flutter''s mother tongue'),
  ('mobile-development', 11, 'Flutter',               'One codebase, two app stores'),
  ('mobile-development', 12, 'Swift',                 'Crossing over to iPhone'),
  ('mobile-development', 13, 'SwiftUI',               'Apple''s way of drawing screens'),
  ('mobile-development', 14, 'App Store Publishing',  'Getting past the gatekeepers'),

  ('data-science',  1, 'Python',      'Your new favourite calculator'),
  ('data-science',  2, 'Jupyter',     'A notebook that runs'),
  ('data-science',  3, 'Excel',       'Where every analyst actually starts'),
  ('data-science',  4, 'NumPy',       'Maths on a whole column at once'),
  ('data-science',  5, 'Pandas',      'Spreadsheets with superpowers'),
  ('data-science',  6, 'SQL',         'Getting the data out'),
  ('data-science',  7, 'Statistics',  'Knowing when a number is lying'),
  ('data-science',  8, 'Matplotlib',  'Turning numbers into pictures'),
  ('data-science',  9, 'Seaborn',     'Pictures that look intentional'),
  ('data-science', 10, 'Power BI',    'Dashboards your boss can click'),
  ('data-science', 11, 'Tableau',     'The other dashboard everyone asks for'),

  ('machine-learning',  1, 'Python',              'The language ML actually speaks'),
  ('machine-learning',  2, 'NumPy',               'Arrays, fast'),
  ('machine-learning',  3, 'Pandas',              'Cleaning the mess before the magic'),
  ('machine-learning',  4, 'SQL',                 'Getting the data out'),
  ('machine-learning',  5, 'Linear Algebra',      'Why everything is a matrix'),
  ('machine-learning',  6, 'Probability',         'Being confidently unsure'),
  ('machine-learning',  7, 'Feature Engineering', 'Feeding the model properly'),
  ('machine-learning',  8, 'scikit-learn',        'Your first model that works'),
  ('machine-learning',  9, 'PyTorch',             'Building the network yourself'),
  ('machine-learning', 10, 'Transformers',        'The thing that ate the field'),
  ('machine-learning', 11, 'LLM APIs',            'Renting a brain'),
  ('machine-learning', 12, 'RAG',                 'Giving the model your notes'),
  ('machine-learning', 13, 'FastAPI',             'Letting other people use it'),
  ('machine-learning', 14, 'Docker',              'It works on my machine, shipped'),

  ('cloud-computing',  1, 'Linux Basics', 'Living in the terminal'),
  ('cloud-computing',  2, 'Networking',   'How computers gossip'),
  ('cloud-computing',  3, 'Bash',         'Making the computer do the boring bit'),
  ('cloud-computing',  4, 'Python',       'Automation that reads like English'),
  ('cloud-computing',  5, 'AWS',          'Renting somebody else''s computer'),
  ('cloud-computing',  6, 'EC2',          'Your server in the sky'),
  ('cloud-computing',  7, 'S3',           'The world''s largest folder'),
  ('cloud-computing',  8, 'IAM',          'Who gets which keys'),
  ('cloud-computing',  9, 'VPC',          'Building your own neighbourhood'),
  ('cloud-computing', 10, 'Lambda',       'Code with no server to babysit'),
  ('cloud-computing', 11, 'Docker',       'Shipping the whole kitchen'),
  ('cloud-computing', 12, 'Kubernetes',   'Herding a thousand containers'),
  ('cloud-computing', 13, 'Terraform',    'Infrastructure you can undo'),

  ('devops',  1, 'Linux',          'Living in the terminal'),
  ('devops',  2, 'Bash',           'Scripting your way out of chores'),
  ('devops',  3, 'Git',            'Branches, merges, and peace'),
  ('devops',  4, 'Python',         'When Bash starts to hurt'),
  ('devops',  5, 'Docker',         'It works on my machine, shipped'),
  ('devops',  6, 'CI/CD',          'Robots that test your code'),
  ('devops',  7, 'GitHub Actions', 'Your first pipeline'),
  ('devops',  8, 'Jenkins',        'The pipeline every company still runs'),
  ('devops',  9, 'Kubernetes',     'Herding containers'),
  ('devops', 10, 'Terraform',      'Infrastructure you can undo'),
  ('devops', 11, 'AWS',            'Where it all actually runs'),
  ('devops', 12, 'Prometheus',     'Knowing something broke'),
  ('devops', 13, 'Grafana',        'Knowing it broke, in colour'),

  ('cybersecurity',  1, 'Linux',            'Living in the terminal'),
  ('cybersecurity',  2, 'Networking',       'How packets actually travel'),
  ('cybersecurity',  3, 'Windows',          'Where most attacks land'),
  ('cybersecurity',  4, 'Active Directory', 'The keys to the whole office'),
  ('cybersecurity',  5, 'Python',           'Scripting your own tools'),
  ('cybersecurity',  6, 'Wireshark',        'Reading the traffic'),
  ('cybersecurity',  7, 'Nmap',             'Knocking on every door'),
  ('cybersecurity',  8, 'Log Analysis',     'Finding the needle'),
  ('cybersecurity',  9, 'Splunk',           'Searching a haystack the size of a company'),
  ('cybersecurity', 10, 'Wazuh',            'The open-source watchtower'),
  ('cybersecurity', 11, 'OWASP Top 10',     'The ten ways websites die'),
  ('cybersecurity', 12, 'Burp Suite',       'Breaking a web app on purpose'),
  ('cybersecurity', 13, 'Security+',        'The badge HR looks for'),

  ('ui-ux-design', 1, 'Wireframing',          'Boxes before beauty'),
  ('ui-ux-design', 2, 'Figma',                'The tool everybody hires for'),
  ('ui-ux-design', 3, 'Auto Layout',          'Designs that survive real text'),
  ('ui-ux-design', 4, 'Prototyping',          'Making it clickable'),
  ('ui-ux-design', 5, 'User Research',        'Asking instead of guessing'),
  ('ui-ux-design', 6, 'Usability Testing',    'Watching someone get lost'),
  ('ui-ux-design', 7, 'Design Systems',       'Deciding once, reusing forever'),
  ('ui-ux-design', 8, 'Accessibility (WCAG)', 'Designing for everyone'),
  ('ui-ux-design', 9, 'HTML/CSS',             'Speaking developer'),

  ('game-development', 1, 'C#',       'Unity''s mother tongue'),
  ('game-development', 2, 'Unity',    'Your first thing that moves'),
  ('game-development', 3, '3D Maths', 'Vectors, and why they matter'),
  ('game-development', 4, 'Physics',  'Gravity you control'),
  ('game-development', 5, 'Blender',  'Making the thing you render'),
  ('game-development', 6, 'C++',      'Where the performance lives'),
  ('game-development', 7, 'Unreal',   'The big engine'),

  ('blockchain', 1, 'JavaScript',               'The glue of every dapp'),
  ('blockchain', 2, 'React',                    'The front of the front-end'),
  ('blockchain', 3, 'Solidity',                 'Writing money-shaped code'),
  ('blockchain', 4, 'EVM Internals',            'What the machine actually does'),
  ('blockchain', 5, 'Hardhat',                  'Testing before it costs real money'),
  ('blockchain', 6, 'Foundry',                  'The fast way to test'),
  ('blockchain', 7, 'ethers.js',                'Talking to the chain'),
  ('blockchain', 8, 'viem',                     'ethers.js, modernised'),
  ('blockchain', 9, 'Smart Contract Security',  'Not losing everyone''s money'),

  ('iot',  1, 'C',              'Close to the metal'),
  ('iot',  2, 'Circuits/PCB',   'Electricity that behaves'),
  ('iot',  3, 'Sensors',        'Letting the thing feel'),
  ('iot',  4, 'ESP32',          'A computer smaller than a coin'),
  ('iot',  5, 'I2C/SPI/UART',   'How chips talk to chips'),
  ('iot',  6, 'C++',            'Structure on a tiny machine'),
  ('iot',  7, 'FreeRTOS',       'Doing two things at once'),
  ('iot',  8, 'STM32',          'The serious microcontroller'),
  ('iot',  9, 'MQTT',           'Getting the data off the device'),
  ('iot', 10, 'Python',         'Reading it all back'),

  ('robotics', 1, 'Python',             'Telling a robot what to do'),
  ('robotics', 2, 'Linear Algebra',     'Where the robot thinks it is'),
  ('robotics', 3, 'C++',                'When milliseconds matter'),
  ('robotics', 4, 'Embedded Systems',   'The brain in the body'),
  ('robotics', 5, 'ROS 2',              'The nervous system'),
  ('robotics', 6, 'Gazebo',             'Crashing it safely first'),
  ('robotics', 7, 'Control Systems',    'Making it stop wobbling'),
  ('robotics', 8, 'OpenCV',             'Giving it eyes');;
