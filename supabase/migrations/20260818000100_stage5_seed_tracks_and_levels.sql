-- ============================================================================
-- Seeded from INTEREST_SKILLS in src/components/onboarding/StudentWizard.tsx.
--
-- Those lists are already ordered as a progression (HTML/CSS before React
-- before Next.js), they already match the interests a student picks at signup,
-- and they are the app's own data rather than content invented here. One level
-- per skill, in the order the list gives. 12 tracks, 140 steps.
--
-- level_content (the lesson and quiz for each step) is written by the existing
-- levels-warm / level-open functions on demand and cached, so nothing here has
-- to call an AI.
-- ============================================================================

insert into public.level_tracks (slug, name, emoji, interest, role, sort_order) values
  ('web-development',    'Web Development',   '🌐', 'Web Development',    'Full Stack Developer',       1),
  ('mobile-development', 'Mobile Apps',       '📱', 'Mobile Development', 'Mobile Developer',           2),
  ('data-science',       'Data Science',      '📊', 'Data Science',       'Data Analyst',               3),
  ('machine-learning',   'Machine Learning',  '🤖', 'Machine Learning',   'ML Engineer',                4),
  ('cloud-computing',    'Cloud',             '☁️', 'Cloud Computing',    'Cloud Engineer',             5),
  ('devops',             'DevOps',            '⚙️', 'DevOps',             'DevOps Engineer',            6),
  ('cybersecurity',      'Cybersecurity',     '🔐', 'Cybersecurity',      'Security Analyst',           7),
  ('ui-ux-design',       'UI / UX Design',    '🎨', 'UI/UX Design',       'Product Designer',           8),
  ('game-development',   'Game Development',  '🎮', 'Game Development',   'Game Developer',             9),
  ('blockchain',         'Blockchain',        '⛓️', 'Blockchain',         'Smart Contract Developer',  10),
  ('iot',                'IoT & Embedded',    '📡', 'IoT',                'Embedded Engineer',         11),
  ('robotics',           'Robotics',          '🦾', 'Robotics',           'Robotics Engineer',         12);

insert into public.levels (track_slug, level_number, skill, title)
select t.slug, s.ord, s.skill, s.skill
from (values
  ('web-development',    array['HTML/CSS','JavaScript','TypeScript','React','Tailwind','Node.js','Express','SQL','PostgreSQL','MongoDB','REST APIs','JWT Auth','Next.js','Vercel','Vue.js','Angular']),
  ('mobile-development', array['Kotlin','Jetpack Compose','Swift','SwiftUI','Flutter','Dart','REST APIs','JSON','Room','SQLite','Firebase','App Store Publishing','Java','React Native']),
  ('data-science',       array['Python','Pandas','NumPy','SQL','Statistics','Matplotlib','Seaborn','Excel','Power BI','Tableau','Jupyter']),
  ('machine-learning',   array['Python','Pandas','NumPy','SQL','scikit-learn','PyTorch','Linear Algebra','Probability','Feature Engineering','FastAPI','Docker','Transformers','LLM APIs','RAG','TensorFlow']),
  ('cloud-computing',    array['AWS','EC2','S3','IAM','VPC','Lambda','Linux','Networking','Docker','Terraform','Python','Bash','Kubernetes','Azure','GCP']),
  ('devops',             array['Linux','Bash','Python','Docker','Kubernetes','Git','CI/CD','GitHub Actions','Terraform','Prometheus','Grafana','AWS','Jenkins']),
  ('cybersecurity',      array['Linux','Networking','Windows','Active Directory','Splunk','Wazuh','Log Analysis','Wireshark','Nmap','Burp Suite','Python','OWASP Top 10','Security+']),
  ('ui-ux-design',       array['Figma','Auto Layout','Design Systems','Wireframing','Prototyping','User Research','Usability Testing','Accessibility (WCAG)','HTML/CSS']),
  ('game-development',   array['Unity','C#','Unreal','C++','3D Maths','Physics','Blender']),
  ('blockchain',         array['Solidity','Foundry','Hardhat','ethers.js','viem','EVM Internals','Smart Contract Security','React','JavaScript']),
  ('iot',                array['C','C++','ESP32','STM32','I2C/SPI/UART','FreeRTOS','MQTT','Sensors','Circuits/PCB','Python']),
  ('robotics',           array['Python','C++','ROS 2','Control Systems','OpenCV','Embedded Systems','Gazebo','Linear Algebra'])
) as t(slug, skills)
cross join lateral unnest(t.skills) with ordinality as s(skill, ord);
