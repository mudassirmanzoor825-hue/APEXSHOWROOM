# Apex Car Showroom

## GitHub pe upload karne ka tareeqa

1. GitHub.com pe login karo, **New repository** banao (e.g. `apex-showroom`) — Public ya Private, koi farq nahi
2. Is poore folder (`apex-showroom`) ke andar ki tamam files GitHub repo mein upload kar do
   - Web browser se: repo page pe **"Add file" → "Upload files"** button use karo, sab files/folders drag-drop kar do
3. Commit kar do

## Vercel se live URL banane ka tareeqa (free, aur zaroori hai kyunke ye React project hai)

1. **vercel.com** pe jao, **"Sign up"** karo aur **GitHub account se login** karo (sabse aasan)
2. Dashboard mein **"Add New" → "Project"** click karo
3. Apni GitHub repo (`apex-showroom`) select karo aur **Import** karo
4. Framework Vercel khud detect kar lega ("Vite") — kuch change karne ki zaroorat nahi
5. **Deploy** button dabao

2-3 minute mein aapko ek live URL milega (jaise `apex-showroom.vercel.app`). Wahan se app khol ke test karo — car add karo aur Google Sheet check karo.

Jab bhi GitHub repo mein naya code push karoge, Vercel khud-ba-khud dobara deploy kar dega.
