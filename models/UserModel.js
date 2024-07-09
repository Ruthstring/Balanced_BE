const mongoose = require('mongoose');


 const userSchema = new mongoose.Schema({
   username: {
     type: String,
     required: true,
   },
   password: {
     type: String,
     required: true,
   },
   email: {
     type: String,
     required: true,
   },
   household_id: {
     type: mongoose.Schema.Types.ObjectId,
     ref: 'Household',
     default: null
   },
   balance: {
     type: Number,
     default: 0,
   },
  
   profilePicture: {
      type: String,
      default: '' 
   }
 });

const User = mongoose.model('User', userSchema);

module.exports = User;
