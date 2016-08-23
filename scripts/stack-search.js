var stackexchange = require('stackexchange')
var Entities = require('html-entities').AllHtmlEntities

module.exports = function(robot) {

  let entities = new Entities();
  let options = { version: 2.2 }
  let context = new stackexchange(options)

  let searchQuery = {
    site: 'stackoverflow',
    sort: 'relevance',
    order: 'desc',
    accepted: true
  }

  let questionQuery = {
    site: 'stackoverflow',
    sort: 'activity',
    order: 'desc',
    filter: '!9YdnSM68f'
  }

  robot.respond(/debug/, function(msg) {

    console.log(msg.robot.name)
    console.log(msg.message.text)
    console.log(msgTxt)
  })

  // Listen to anyone approaching this bot
  robot.respond(/.*/, function(msg) {

    // Extract the actual question
    let botNameRegEx = new RegExp("@*" + msg.robot.name + ":*")
    let msgTxt = msg.message.text.replace(botNameRegEx, '').trim()

    searchQuery.q = msgTxt

    // Perform advanced search
    context.search.advanced(searchQuery, function(err, response) {
      if (err) {
        console.error('Search error', err);
        msg.send('Oh oh.. something went wrong with search', err)
        return
      }

      if (response.items.length === 0) {
        msg.reply('Wow.. this is too much for me, don\'t have an answer for you. Try rephrasing your question')
        return
      }

      // Get the most relevant question
      let relevantQuestion = response.items[0];

      msg.send('Here is what I know about *' + relevantQuestion.title + "*")

      // Get answers for relevant question
      context.questions.answers(questionQuery, function(err, response) {
        if (err) {
          console.error('Answer error', err);
          msg.send('Oh oh.. something went wrong with answers', err)
          return
        }

        // Find the accepted answer
        let acceptedAnswer = response.items.find(function(answer) {
          return answer.is_accepted;
        })

        // Reply with accepted answer
        if (acceptedAnswer) {
          msg.send(entities.decode(acceptedAnswer.body_markdown))
          return
        }

        msg.send('Hmmm.. couldn\'t find an answer')

      }, [relevantQuestion.question_id])
    })
  });
}
