Table SCHOOL {
  _id objectid [pk]
  detail object
  contact object[]
  createBy objectid
  createAt date
  editAt date
}

Table USER {
  _id objectid [pk]
  username string
  password string
  role int [note: '3 โรลยังไม่ชัดเจน']
  detail object
  active int [note: '0,1']
  createAt date
  updateAt date
}

Table TRACKING {
  _id objectid [pk]
  schoolId objectid
  createBy objectid
  detail string
  status int [note: '1,2,3,4,5,6,7,8']
  comment string
  staff objectid
  processAt date
  doneAt date
  completeAt date
  cancelAt date
  createAt date
  updateAt date
}

Table MEETING [note: 'user who createBy can edit (only) — THEERANAT AIYARAKHOM'] {
  _id objectid [pk]
  trackingId objectid
  createBy objectid
  type string [note: 'online/onsite']
  link_or_location string
  staff objectid
  detail string
  product json[]
  status int [note: '2,6,7,8']
  result string [note: 'remark+result']
  time date
  completeAt date
  cancelAt date
  createAt date
  updateAt date
}

Table IMPLEMENT [note: 'user who createBy can edit (only) — THEERANAT AIYARAKHOM'] {
  _id objectid [pk]
  meetingId objectid
  createBy objectid
  staff objectid
  detail string
  product json[]
  status int [note: '2,6,7,8']
  result string [note: 'remark+result']
  time date
  completeAt date
  cancelAt date
  createAt date
  updateAt date
}

Table STATUS_reference {
  Code int [not null]
  Status_TH varchar(255) [not null]
}

Ref: SCHOOL.createBy > USER._id
Ref: TRACKING.schoolId > SCHOOL._id
Ref: TRACKING.createBy > USER._id
Ref: TRACKING.staff > USER._id
Ref: MEETING.trackingId > TRACKING._id
Ref: MEETING.createBy > USER._id
Ref: MEETING.staff > USER._id
Ref: IMPLEMENT.meetingId > MEETING._id
Ref: IMPLEMENT.createBy > USER._id
Ref: IMPLEMENT.staff > USER._id
