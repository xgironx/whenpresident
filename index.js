var express = require("express");
var parser  = require("body-parser");
var hbs     = require("express-handlebars");
var session = require("express-session");
var cmongo  = require("connect-mongo");
var request = require("request");
var qstring = require("qs");
var env     = require("./env");
var mongoose= require("./db/connection");

var app     = express();
var SMongo  = cmongo(session);

var Candidate = mongoose.model("Candidate");

process.env.session_secret = env.session_secret;
process.env.t_callback_url = env.t_callback_url;
process.env.t_consumer_key = env.t_consumer_key;
process.env.t_consumer_secret = env.t_consumer_secret;

app.use(session({
  secret: process.env.session_secret,
  resave: false,
  saveUninitialized: false,
  store: new SMongo({
    mongooseConnection: mongoose.connection
  })
}));

app.set("port", process.env.PORT || 3001);
app.set("view engine", "hbs");
app.engine(".hbs", hbs({
  extname:        ".hbs",
  partialsDir:    "views/",
  layoutsDir:     "views/",
  defaultLayout:  "layout-main"
}));
app.use("/assets", express.static("public"));
app.use(parser.urlencoded({extended: true}));
app.use(function(req, res, next){
  Candidate.findById(req.session.candidate_id).then(function(candidate){
    if(candidate) res.locals.user = candidate;
    next();
  });
});

app.get("/", function(req, res){
  res.render("app-welcome");
});

app.get("/login/twitter", function(req, res){
  var url = "https://api.twitter.com/oauth/request_token";
  var oauth = {
    callback:         process.env.t_callback_url,
    consumer_key:     process.env.t_consumer_key,
    consumer_secret:  process.env.t_consumer_secret
  }
  request.post({url: url, oauth: oauth}, function(e, response){
    var auth_data = qstring.parse(response.body);
    var post_data = qstring.stringify({oauth_token: auth_data.oauth_token});
    req.session.t_oauth_token         = auth_data.oauth_token;
    req.session.t_oauth_token_secret  = auth_data.oauth_token_secret;
    res.redirect("https://api.twitter.com/oauth/authenticate?" + post_data);
  });
});

app.get("/login/twitter/callback", function(req, res){
  var url = "https://api.twitter.com/oauth/access_token";
  var auth_data = qstring.parse(req.query);
  var oauth = {
    consumer_key:     process.env.t_consumer_key,
    consumer_secret:  process.env.t_consumer_secret,
    token:            req.session.t_oauth_token,
    token_secret:     req.session.t_oauth_token_secret,
    verifier:         auth_data.oauth_verifier
  }
  request.post({url: url, oauth: oauth}, function(e, response){
    var auth_data = qstring.parse(response.body);
    req.session.t_user_id             = auth_data.user_id;
    req.session.t_screen_name         = auth_data.screen_name;
    req.session.t_oauth               = {
      consumer_key:     process.env.t_consumer_key,
      consumer_secret:  process.env.t_consumer_secret,
      token:            auth_data.oauth_token,
      token_secret:     auth_data.oauth_token_secret
    }
    request.get({
      url:    "https://api.twitter.com/1.1/users/show.json",
      json:   true,
      oauth:  req.session.t_oauth,
      qs:     {
        screen_name: req.session.t_screen_name
      }
    }, function(e, response){
      var candidate_info = {
        name:         response.body.name,
        t_id:         response.body.id,
        t_username:   response.body.screen_name,
        t_photo_url:  response.body.profile_image_url
      }
      Candidate.findOneAndUpdate({t_id: response.body.id}, candidate_info, {new: true}).then(function(candidate){
        if(candidate){
          sendCandidate(candidate);
        }else{
          Candidate.create(candidate_info).then(sendCandidate);
        }
      });
      function sendCandidate(candidate){
        req.session.candidate_id = candidate._id;
        res.redirect("/");
      }
    });
  });
});


app.get("/apitest/:username", function(req, res){
  request.get({
    url:    "https://api.twitter.com/1.1/statuses/user_timeline.json",
    json:   true,
    oauth:  req.session.t_oauth,
    qs:     {
      screen_name: req.params.username,
      count: 2
    }
  }, function(e, response){
    res.json(response.body);
  });

app.get("/logout", function(req, res){
  req.session.destroy();
  res.redirect("/");
});

app.get("/candidates", function(req, res){
  Candidate.find({}).then(function(candidates){
    res.render("candidates-index", {
      candidates: candidates
    });
  });
});

app.get("/candidates/:name", function(req, res){
  Candidate.findOne({name: req.params.name}).then(function(candidate){
    res.render("candidates-show", {
      candidate: candidate
    });
  });
});

app.post("/candidates/:name/delete", function(req, res){
  Candidate.findOneAndRemove({name: req.params.name}).then(function(){
    res.redirect("/candidates")
  });
});

app.post("/candidates/:name", function(req, res){
  Candidate.findOneAndUpdate({name: req.params.name}, req.body.candidate, {new: true}).then(function(candidate){
    res.redirect("/candidates/" + candidate.name);
  });
});

app.post("/candidates/:name/positions", function(req, res){
  Candidate.findOne({name: req.params.name}).then(function(candidate){
    candidate.positions.push(req.body.position);
    candidate.save().then(function(){
      res.redirect("/candidates/" + candidate.name);
    });
  });
});

app.post("/candidates/:name/positions/:index", function(req, res){
  Candidate.findOne({name: req.params.name}).then(function(candidate){
    candidate.positions.splice(req.params.index, 1);
    candidate.save().then(function(){
      res.redirect("/candidates/" + candidate.name);
    });
  });
});

app.listen(app.get("port"), function(){
  console.log("It's aliiive!");
});
