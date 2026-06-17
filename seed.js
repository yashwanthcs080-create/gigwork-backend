// seed.js — Populate demo workers & reviews for hackathon demo
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { User, Review, Booking } = require('./models');

function fakeTx() {
  return '0x' + Array.from({length:64}, () => '0123456789abcdef'[Math.floor(Math.random()*16)]).join('');
}

async function seed() {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/worktrust');
  console.log('Connected. Clearing old data...');
  await User.deleteMany({}); await Review.deleteMany({}); await Booking.deleteMany({});

  const hashed = await bcrypt.hash('password123', 12);

  const workers = await User.insertMany([
    {
      role:'worker', email:'ravi@worktrust.in', password: hashed,
      name:'Ravi Kumar', phone:'9876543210', trade:'Electrician', experience:9,
      available:true, serviceRadius:30, hourlyRate:450, jobRate:2200,
      address:{ street:'12B Linking Road', area:'Bandra West', city:'Mumbai', state:'Maharashtra', pin:'400050', lat:19.0596, lng:72.8295 },
      skills:[
        {name:'Electrical Wiring',level:'Expert'},{name:'Panel Installation',level:'Expert'},
        {name:'CCTV & Security',level:'Intermediate'},{name:'Solar Panel Setup',level:'Intermediate'},
        {name:'EV Charging Points',level:'Beginner'}
      ],
      certifications:[
        {id:'aadhaar',name:'Aadhaar Verification',issuer:'UIDAI',icon:'🪪',verified:false},
        {id:'iti',name:'ITI Electrician Certificate',issuer:'Govt ITI Mumbai',icon:'📜',verified:false},
        {id:'license',name:'Wireman License',issuer:'MSEDCL',icon:'⚡',verified:false},
        {id:'safety',name:'Safety Training',issuer:'NSDC',icon:'🏥',verified:false},
        {id:'police',name:'Police Verification',issuer:'Mumbai Police',icon:'🚔',verified:false}
      ],
      badges:[
        {name:'Top Rated 2024',icon:'⭐',earnedAt:new Date(),txHash:fakeTx()},
        {name:'200+ Jobs',icon:'🏆',earnedAt:new Date(),txHash:fakeTx()},
        {name:'5-Star Streak',icon:'🔥',earnedAt:new Date(),txHash:fakeTx()}
      ],
      portfolioImages:[],
      qrToken: uuidv4(),
      liveLocation:{ lat:19.0596, lng:72.8295, updatedAt:new Date() }
    },
    {
      role:'worker', email:'suresh@worktrust.in', password: hashed,
      name:'Suresh Yadav', phone:'9823456701', trade:'Plumber', experience:12,
      available:true, serviceRadius:25, hourlyRate:380, jobRate:1800,
      address:{ street:'45 Shivaji Nagar', area:'Camp', city:'Pune', state:'Maharashtra', pin:'411001', lat:18.5204, lng:73.8567 },
      skills:[
        {name:'Pipe Fitting',level:'Expert'},{name:'Bathroom Fitting',level:'Expert'},
        {name:'Leak Repair',level:'Expert'},{name:'Water Heater Install',level:'Intermediate'}
      ],
      certifications:[
        {id:'aadhaar',name:'Aadhaar Verification',issuer:'UIDAI',icon:'🪪',verified:false},
        {id:'iti',name:'ITI Plumbing Certificate',issuer:'Govt ITI Pune',icon:'📜',verified:false},
        {id:'license',name:'Trade License',issuer:'PMC',icon:'🔧',verified:false},
        {id:'safety',name:'Safety Training',issuer:'NSDC',icon:'🏥',verified:false},
        {id:'police',name:'Police Verification',issuer:'Pune Police',icon:'🚔',verified:false}
      ],
      badges:[{name:'10 Jobs Done',icon:'🌟',earnedAt:new Date(),txHash:fakeTx()}],
      portfolioImages:[], qrToken: uuidv4(),
      liveLocation:{ lat:18.5204, lng:73.8567, updatedAt:new Date() }
    },
    {
      role:'worker', email:'meena@worktrust.in', password: hashed,
      name:'Meena Devi', phone:'9900112233', trade:'Domestic Worker', experience:6,
      available:true, serviceRadius:15, hourlyRate:200, jobRate:800,
      address:{ street:'7 Gandhi Colony', area:'Koramangala', city:'Bengaluru', state:'Karnataka', pin:'560034', lat:12.9352, lng:77.6245 },
      skills:[
        {name:'House Cleaning',level:'Expert'},{name:'Cooking',level:'Expert'},
        {name:'Child Care',level:'Intermediate'},{name:'Elderly Care',level:'Intermediate'}
      ],
      certifications:[
        {id:'aadhaar',name:'Aadhaar Verification',issuer:'UIDAI',icon:'🪪',verified:false},
        {id:'iti',name:'Domestic Skills Certificate',issuer:'NSDC',icon:'📜',verified:false},
        {id:'license',name:'ID Card',issuer:'Municipal Corp',icon:'🪪',verified:false},
        {id:'safety',name:'First Aid Training',issuer:'Red Cross',icon:'🏥',verified:false},
        {id:'police',name:'Police Verification',issuer:'Bengaluru Police',icon:'🚔',verified:false}
      ],
      badges:[{name:'Profile Created',icon:'🆕',earnedAt:new Date(),txHash:fakeTx()}],
      portfolioImages:[], qrToken: uuidv4(),
      liveLocation:{ lat:12.9352, lng:77.6245, updatedAt:new Date() }
    }
  ]);

  console.log('✅ Created', workers.length, 'workers');

  // Seed reviews for Ravi
  const raviReviews = [
    { clientName:'Priya Deshmukh', clientType:'Residential', workType:'Full Electrical Wiring',
      mainStar:5, reliability:5, skillQuality:5, punctuality:4, communication:5, repeatHires:5,
      text:'Ravi was thorough and professional. Finished the 3BHK wiring on time, even stayed late on day 3. Highly recommend.',
      dateOfWork: new Date('2025-02-18'), daysWorked:4, whenReview:'2 days ago',
      location:{text:'Andheri West, Mumbai',lat:19.1136,lng:72.8697}, clientIp:'1.2.3.4' },
    { clientName:'Aditya Sharma', clientType:'Commercial', workType:'Panel Upgrade & UPS',
      mainStar:5, reliability:5, skillQuality:5, punctuality:5, communication:4, repeatHires:5,
      text:'We needed urgent office panel upgrade. Ravi showed up next morning and finished in two days. No shortcuts.',
      dateOfWork: new Date('2025-01-03'), daysWorked:2, whenReview:'1 week ago',
      location:{text:'Kurla, Mumbai',lat:19.0726,lng:72.8791}, clientIp:'1.2.3.5' },
    { clientName:'Meenakshi Krishnan', clientType:'Residential', workType:'CCTV 4 Camera Setup',
      mainStar:4, reliability:4, skillQuality:4, punctuality:3, communication:4, repeatHires:4,
      text:'Overall good experience. CCTV installation done neatly. Slight delay on day 2 but communicated beforehand.',
      dateOfWork: new Date('2024-11-15'), daysWorked:1, whenReview:'2 weeks ago',
      location:{text:'Thane, Maharashtra',lat:19.2183,lng:72.9781}, clientIp:'1.2.3.6' }
  ];

  for (const r of raviReviews) {
    await Review.create({ ...r, workerId: workers[0]._id, qrToken: workers[0].qrToken, method:'QR Verified', txHash:fakeTx() });
  }

  // Recompute Ravi's reputation
  const reviews = await Review.find({ workerId: workers[0]._id });
  const avg = k => reviews.reduce((s,r)=>s+r[k],0)/reviews.length;
  await User.findByIdAndUpdate(workers[0]._id, { reputation: {
    score: 87, reliability:+avg('reliability').toFixed(1),
    skillQuality:+avg('skillQuality').toFixed(1), punctuality:+avg('punctuality').toFixed(1),
    communication:+avg('communication').toFixed(1), repeatHires:+avg('repeatHires').toFixed(1),
    totalReviews: reviews.length, avgStar:+avg('mainStar').toFixed(1)
  }});

  // Seed a demo client
  await User.create({
    role:'client', email:'client@worktrust.in', password: hashed,
    name:'Anjali Mehta', phone:'9112233445',
    neededTrades:['Electrician','Plumber'],
    address:{ street:'101 Park Street', area:'Andheri East', city:'Mumbai', state:'Maharashtra', pin:'400069', lat:19.1197, lng:72.8671 }
  });

  console.log('✅ Reviews seeded for Ravi');
  console.log('\n🔑 Demo Login Credentials:');
  console.log('   Worker: ravi@worktrust.in / password123');
  console.log('   Worker: suresh@worktrust.in / password123');
  console.log('   Client: client@worktrust.in / password123\n');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
