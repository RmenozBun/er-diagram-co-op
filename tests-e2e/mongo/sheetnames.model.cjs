const mongoose = require('mongoose')
const { Schema } = mongoose

const DupSchema = new Schema(
  {
    
  },
  { timestamps: false },
)
const Dup = mongoose.model("Dup", DupSchema, "Dup")

const Dup2Schema = new Schema(
  {
    x: { type: Number },
  },
  { timestamps: false },
)
const Dup2 = mongoose.model("Dup2", Dup2Schema, "Dup_2")

const MySheetV2Schema = new Schema(
  {
    
  },
  { timestamps: false },
)
const MySheetV2 = mongoose.model("MySheetV2", MySheetV2Schema, "my_sheet_v2")

const ผู้ใช้งานSchema = new Schema(
  {
    
  },
  { timestamps: false },
)
const ผู้ใช้งาน = mongoose.model("ผู้ใช้งาน", ผู้ใช้งานSchema, "ผู้ใช้งาน")

const ลูกค้าSchema = new Schema(
  {
    
  },
  { timestamps: false },
)
const ลูกค้า = mongoose.model("ลูกค้า", ลูกค้าSchema, "ลูกค้า")

const _2024DataSchema = new Schema(
  {
    
  },
  { timestamps: false },
)
const _2024Data = mongoose.model("_2024Data", _2024DataSchema, "2024_data")

const ABCSchema = new Schema(
  {
    
  },
  { timestamps: false },
)
const ABC = mongoose.model("ABC", ABCSchema, "a_b_c")

const TableSchema = new Schema(
  {
    
  },
  { timestamps: false },
)
const Table = mongoose.model("Table", TableSchema, "table")

const Table2Schema = new Schema(
  {
    
  },
  { timestamps: false },
)
const Table2 = mongoose.model("Table2", Table2Schema, "table_2")

const Sheet1Schema = new Schema(
  {
    
  },
  { timestamps: false },
)
const Sheet1 = mongoose.model("Sheet1", Sheet1Schema, "Sheet1")

const Sheet12Schema = new Schema(
  {
    
  },
  { timestamps: false },
)
const Sheet12 = mongoose.model("Sheet12", Sheet12Schema, "sheet1_2")

const ProtoSchema = new Schema(
  {
    
  },
  { timestamps: false },
)
const Proto = mongoose.model("Proto", ProtoSchema, "proto")

const ConstructorSchema = new Schema(
  {
    
  },
  { timestamps: false },
)
const Constructor = mongoose.model("Constructor", ConstructorSchema, "constructor")

module.exports = { Dup, Dup2, MySheetV2, ผู้ใช้งาน, ลูกค้า, _2024Data, ABC, Table, Table2, Sheet1, Sheet12, Proto, Constructor }
